// TODO lazy loading
// TODO media events
// TODO height adapting
// TODO can height adapting remove need for 16x9 dummy in the media carousel?
// TODO controls

import { CSSResultGroup, LitElement, TemplateResult, html, unsafeCSS } from 'lit';
import type {
  BrowseMediaSource,
  ExtendedHomeAssistant,
  CameraConfig,
  JSMPEGConfig,
  LiveConfig,
  MediaShowInfo,
  WebRTCConfig,
} from '../types.js';
import { EmblaOptionsType } from 'embla-carousel';
import { HomeAssistant } from 'custom-card-helpers';
import { customElement, property } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';

import { BrowseMediaUtil } from '../browse-media-util.js';
import { FrigateCardMediaCarousel } from './media-carousel.js';
import { ThumbnailCarouselTap } from './thumbnail-carousel.js';
import { View } from '../view.js';
import { localize } from '../localize/localize.js';
import {
  dispatchErrorMessageEvent,
  dispatchExistingMediaShowInfoAsEvent,
  dispatchMediaShowEvent,
  dispatchMessageEvent,
  dispatchPauseEvent,
  dispatchPlayEvent,
  homeAssistantSignPath,
} from '../common.js';
import { renderProgressIndicator } from '../components/message.js';

import JSMpeg from '@cycjimmy/jsmpeg-player';

import liveStyle from '../scss/live.scss';
import liveFrigateStyle from '../scss/live-frigate.scss';
import liveJSMPEGStyle from '../scss/live-jsmpeg.scss';
import liveWebRTCStyle from '../scss/live-webrtc.scss';

// Number of seconds a signed URL is valid for.
const URL_SIGN_EXPIRY_SECONDS = 24 * 60 * 60;

// Number of seconds before the expiry to trigger a refresh.
const URL_SIGN_REFRESH_THRESHOLD_SECONDS = 1 * 60 * 60;

@customElement('frigate-card-live')
export class FrigateCardLive extends LitElement {
  @property({ attribute: false })
  protected hass?: HomeAssistant & ExtendedHomeAssistant;

  @property({ attribute: false })
  protected view?: View;

  @property({ attribute: false })
  protected cameras?: Map<string, CameraConfig>;

  @property({ attribute: false })
  protected liveConfig?: LiveConfig;

  @property({ attribute: false })
  set preload(preload: boolean) {
    this._preload = preload;

    if (!preload && this._savedMediaShowInfo) {
      dispatchExistingMediaShowInfoAsEvent(this, this._savedMediaShowInfo);
    }
  }

  // Whether or not the live view is currently being preloaded.
  protected _preload?: boolean;

  // MediaShowInfo object from the underlying live object. In the case of
  // pre-loading it may be propagated upwards later.
  protected _savedMediaShowInfo?: MediaShowInfo;

  /**
   * Handler for media show events that special cases preloaded live views.
   * @param e The media show event.
   */
  protected _mediaShowHandler(e: CustomEvent<MediaShowInfo>): void {
    this._savedMediaShowInfo = e.detail;
    if (this._preload) {
      // If live is being pre-loaded, don't let the event propogate upwards yet
      // as the media is not really being shown.
      e.stopPropagation();
    }
  }

  /**
   * Render thumbnails carousel.
   * @returns A rendered template or void.
   */
  protected renderThumbnails(): TemplateResult | void {
    if (!this.liveConfig || !this.view) {
      return;
    }

    const fetchThumbnailsThenRender = async (): Promise<TemplateResult | void> => {
      if (!this.hass || !this.cameras || !this.view || !this.liveConfig) {
        return;
      }
      const browseMediaParams = BrowseMediaUtil.getBrowseMediaQueryParameters(
        this.liveConfig.controls.thumbnails.media,
        this.cameras.get(this.view.camera),
      );
      if (!browseMediaParams) {
        return;
      }
      let parent: BrowseMediaSource | null;
      try {
        parent = await BrowseMediaUtil.browseMediaQuery(this.hass, browseMediaParams);
      } catch (e) {
        return dispatchErrorMessageEvent(this, (e as Error).message);
      }

      if (BrowseMediaUtil.getFirstTrueMediaChildIndex(parent) != null) {
        return html` <frigate-card-thumbnail-carousel
          .target=${parent}
          .view=${this.view}
          .config=${this.liveConfig?.controls.thumbnails}
          .highlightSelected=${false}
          @frigate-card:carousel:tap=${(ev: CustomEvent<ThumbnailCarouselTap>) => {
            const mediaType = browseMediaParams.mediaType;
            if (mediaType && this.view && ['snapshots', 'clips'].includes(mediaType)) {
              new View({
                view: mediaType === 'clips' ? 'clip-specific' : 'snapshot-specific',
                camera: this.view.camera,
                target: ev.detail.target,
                childIndex: ev.detail.childIndex,
              }).dispatchChangeEvent(this);
            }
          }}
        >
        </frigate-card-thumbnail-carousel>`;
      }
    };

    return html`${until(fetchThumbnailsThenRender(), renderProgressIndicator())}`;
  }

  /**
   * Master render method.
   * @returns A rendered template.
   */
  protected render(): TemplateResult | void {
    if (!this.hass || !this.liveConfig || !this.cameras) {
      return;
    }

    return html`
      ${this.liveConfig.controls.thumbnails.mode === 'above'
        ? this.renderThumbnails()
        : ''}
      <frigate-card-live-carousel
        .hass=${this.hass}
        .view=${this.view}
        .cameras=${this.cameras}
        .liveConfig=${this.liveConfig}
        @frigate-card:media-show=${this._mediaShowHandler}
        @frigate-card:carousel:select=${() => {
          // Re-rendering the component will cause the thumbnails to be
          // re-fetched.
          this.requestUpdate();
        }}
      >
      </frigate-card-live-carousel>
      ${this.liveConfig.controls.thumbnails.mode === 'below'
        ? this.renderThumbnails()
        : ''}
    `;
  }

  /**
   * Get styles.
   */
  static get styles(): CSSResultGroup {
    return unsafeCSS(liveStyle);
  }
}

@customElement('frigate-card-live-carousel')
export class FrigateCardLiveCarousel extends FrigateCardMediaCarousel {
  @property({ attribute: false })
  protected hass?: HomeAssistant & ExtendedHomeAssistant;

  @property({ attribute: false })
  protected view?: View;

  @property({ attribute: false })
  protected cameras?: Map<string, CameraConfig>;

  @property({ attribute: false })
  protected liveConfig?: LiveConfig;

  /**
   * Get the Embla options to use.
   * @returns An EmblaOptionsType object or undefined for no options.
   */
  protected _getOptions(): EmblaOptionsType {
    let startIndex = -1;
    if (this.cameras && this.view) {
      startIndex = Array.from(this.cameras.keys()).indexOf(this.view.camera);
    }

    return {
      startIndex: startIndex < 0 ? undefined : startIndex,
      // TODO: draggable: this.viewerConfig.draggable,
    };
  }

  /**
   * Returns the number of slides to lazily load. 0 means all slides are lazy
   * loaded, 1 means that 1 slide on each side of the currently selected slide
   * should lazy load, etc. `null` means lazy loading is disabled and everything
   * should load simultaneously.
   * @returns
   */
  protected _getLazyLoadCount(): number | null {
    // Defaults to fully-lazy loading.
    return 0;
  }

  /**
   * Get slides to include in the render.
   * @returns The slides to include in the render.
   */
  protected _getSlides(): TemplateResult[] {
    if (!this.cameras) {
      return [];
    }
    return Array.from(this.cameras.values()).map((cameraConfig, index) =>
      this._renderLive(cameraConfig, index),
    );
  }

  /**
   * Handle the user selecting a new slide in the carousel.
   */
  protected _selectSlideSetViewHandler(): void {
    if (!this._carousel || !this.view || !this.cameras) {
      return;
    }

    const selectedSnap = this._carousel.selectedScrollSnap();
    this.view.camera = Array.from(this.cameras.keys())[selectedSnap];
  }

  /**
   * Lazy load a slide.
   * @param _slide The slide to lazy load.
   */
  protected _lazyLoadSlide(slide: HTMLElement): void {
    const liveProvider = slide.querySelector(
      'frigate-card-live-provider',
    ) as FrigateCardLiveProvider;
    if (liveProvider) {
      liveProvider.lazyLoad = false;
    }
  }

  protected _renderLive(cameraConfig: CameraConfig, slideIndex: number): TemplateResult {
    return html` <div class="embla__slide">
      <frigate-card-live-provider
        .hass=${this.hass}
        .cameraConfig=${cameraConfig}
        .liveConfig=${this.liveConfig}
        ?lazyLoad=${this._getLazyLoadCount() != null}
        @frigate-card:media-show=${(e: CustomEvent<MediaShowInfo>) =>
          this._mediaShowEventHandler(slideIndex, e)}
      >
      </frigate-card-live-provider>
    </div>`;
  }

  /**
   * Render the element.
   * @returns A template to display to the user.
   */
  protected render(): TemplateResult | void {
    const slides = this._getSlides();
    if (!slides) {
      return;
    }

    // ${neighbors && neighbors.previous
    //   ? html`<frigate-card-next-previous-control
    //       .direction=${'previous'}
    //       .controlConfig=${this.viewerConfig?.controls.next_previous}
    //       .thumbnail=${neighbors.previous.thumbnail}
    //       .title=${neighbors.previous.title}
    //       .actionHandler=${actionHandler({
    //         hasHold: false,
    //         hasDoubleClick: false,
    //       })}
    //       @action=${() => {
    //         this._nextPreviousHandler('previous');
    //       }}
    //     ></frigate-card-next-previous-control>`
    //   : ``}

    return html`<div class="embla">
      <div class="embla__viewport">
        <div class="embla__container">${slides}</div>
      </div>
    </div>`;
    // ${neighbors && neighbors.next
    //   ? html`<frigate-card-next-previous-control
    //       .direction=${'next'}
    //       .controlConfig=${this.viewerConfig?.controls.next_previous}
    //       .thumbnail=${neighbors.next.thumbnail}
    //       .title=${neighbors.next.title}
    //       .actionHandler=${actionHandler({
    //         hasHold: false,
    //         hasDoubleClick: false,
    //       })}
    //       @action=${() => {
    //         this._nextPreviousHandler('next');
    //       }}
    //     ></frigate-card-next-previous-control>`
    //   : ``}
  }
}

@customElement('frigate-card-live-provider')
export class FrigateCardLiveProvider extends LitElement {
  @property({ attribute: false })
  protected hass?: HomeAssistant & ExtendedHomeAssistant;

  @property({ attribute: false })
  protected cameraConfig?: CameraConfig;

  @property({ attribute: false })
  protected liveConfig?: LiveConfig;

  // Whether or not to lazy load this slide. If `true`, no contents are rendered
  // until this attribute is set to `false`.
  @property({ attribute: true, type: Boolean })
  public lazyLoad = false;

  /**
   * Master render method.
   * @returns A rendered template.
   */
  protected render(): TemplateResult | void {
    if (this.lazyLoad || !this.hass || !this.liveConfig || !this.cameraConfig) {
      return;
    }

    return html`
      ${this.liveConfig.provider == 'frigate'
        ? html` <frigate-card-live-frigate
            .hass=${this.hass}
            .cameraEntity=${this.cameraConfig.camera_entity}
          >
          </frigate-card-live-frigate>`
        : this.liveConfig.provider == 'webrtc'
        ? html`<frigate-card-live-webrtc
            .hass=${this.hass}
            .webRTCConfig=${this.liveConfig.webrtc || {}}
          >
          </frigate-card-live-webrtc>`
        : html` <frigate-card-live-jsmpeg
            .hass=${this.hass}
            .cameraName=${this.cameraConfig.camera_name}
            .clientId=${this.cameraConfig.client_id}
            .jsmpegConfig=${this.liveConfig.jsmpeg}
          >
          </frigate-card-live-jsmpeg>`}
    `;
  }
}

@customElement('frigate-card-live-frigate')
export class FrigateCardLiveFrigate extends LitElement {
  @property({ attribute: false })
  protected hass?: HomeAssistant & ExtendedHomeAssistant;

  @property({ attribute: false })
  protected cameraEntity?: string;

  /**
   * Master render method.
   * @returns A rendered template.
   */
  protected render(): TemplateResult | void {
    if (!this.hass) {
      return;
    }

    if (!this.cameraEntity || !(this.cameraEntity in this.hass.states)) {
      return dispatchMessageEvent(
        this,
        localize('error.no_live_camera'),
        'mdi:camera-off',
      );
    }
    return html` <frigate-card-ha-camera-stream
      .hass=${this.hass}
      .stateObj=${this.hass.states[this.cameraEntity]}
      .controls=${true}
      .muted=${true}
    >
    </frigate-card-ha-camera-stream>`;
  }

  /**
   * Get styles.
   */
  static get styles(): CSSResultGroup {
    return unsafeCSS(liveFrigateStyle);
  }
}

// Create a wrapper for the WebRTC element
//  - https://github.com/AlexxIT/WebRTC
@customElement('frigate-card-live-webrtc')
export class FrigateCardLiveWebRTC extends LitElement {
  @property({ attribute: false })
  protected webRTCConfig?: WebRTCConfig;

  protected hass?: HomeAssistant & ExtendedHomeAssistant;
  protected _webRTCElement: HTMLElement | null = null;
  protected _callbacksAdded = false;

  /**
   * Create the WebRTC element. May throw.
   */
  protected _createWebRTC(): TemplateResult | void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webrtcElement = customElements.get('webrtc-camera') as any;
    if (webrtcElement) {
      const webrtc = new webrtcElement();
      webrtc.setConfig(this.webRTCConfig);
      webrtc.hass = this.hass;
      this._webRTCElement = webrtc;
    } else {
      throw new Error(localize('error.missing_webrtc'));
    }
  }

  /**
   * Master render method.
   * @returns A rendered template.
   */
  protected render(): TemplateResult | void {
    if (!this.hass) {
      return;
    }
    if (!this._webRTCElement) {
      try {
        this._createWebRTC();
      } catch (e) {
        return dispatchErrorMessageEvent(this, (e as Error).message);
      }
    }
    return html`${this._webRTCElement}`;
  }

  /**
   * Updated lifecycle callback.
   */
  public updated(): void {
    if (this._callbacksAdded) {
      return;
    }

    // Extract the video component after it has been rendered and generate the
    // media load event.
    this.updateComplete.then(() => {
      const video = this.renderRoot.querySelector('#video') as HTMLVideoElement;
      if (video) {
        const onloadedmetadata = video.onloadedmetadata;
        const onplay = video.onplay;
        const onpause = video.onpause;

        video.onloadedmetadata = (e) => {
          if (onloadedmetadata) {
            onloadedmetadata.call(video, e);
          }
          dispatchMediaShowEvent(this, video);
        };
        video.onplay = (e) => {
          if (onplay) {
            onplay.call(video, e);
          }
          dispatchPlayEvent(this);
        };
        video.onpause = (e) => {
          if (onpause) {
            onpause.call(video, e);
          }
          dispatchPauseEvent(this);
        };
        this._callbacksAdded = true;
      }
    });
  }

  /**
   * Get styles.
   */
  static get styles(): CSSResultGroup {
    return unsafeCSS(liveWebRTCStyle);
  }
}

@customElement('frigate-card-live-jsmpeg')
export class FrigateCardLiveJSMPEG extends LitElement {
  @property({ attribute: false })
  protected cameraName?: string;

  @property({ attribute: false })
  protected clientId?: string;

  @property({ attribute: false })
  protected jsmpegConfig?: JSMPEGConfig;

  @property({ attribute: false })
  protected hass?: HomeAssistant & ExtendedHomeAssistant;
  protected _jsmpegCanvasElement?: HTMLCanvasElement;
  protected _jsmpegVideoPlayer?: JSMpeg.VideoElement;
  protected _refreshPlayerTimerID?: number;

  /**
   * Get a signed player URL.
   * @returns A URL or null.
   */
  protected async _getURL(): Promise<string | null> {
    if (!this.hass || !this.clientId || !this.cameraName) {
      return null;
    }

    let response: string | null | undefined;
    try {
      response = await homeAssistantSignPath(
        this.hass,
        `/api/frigate/${this.clientId}` + `/jsmpeg/${this.cameraName}`,
        URL_SIGN_EXPIRY_SECONDS,
      );
    } catch (err) {
      console.warn(err);
      return null;
    }
    if (!response) {
      return null;
    }
    return response.replace(/^http/i, 'ws');
  }

  /**
   * Create a JSMPEG player.
   * @returns A JSMPEG player.
   */
  protected _createJSMPEGPlayer(url: string): JSMpeg.VideoElement {
    let videoDecoded = false;

    const jsmpegOptions = {
      pauseWhenHidden: false,
      protocols: [],
      audio: false,
      videoBufferSize: 1024 * 1024 * 4,
      onVideoDecode: () => {
        // This is the only callback that is called after the dimensions
        // are available. It's called on every frame decode, so just
        // ignore any subsequent calls.
        if (!videoDecoded && this._jsmpegCanvasElement) {
          videoDecoded = true;
          dispatchMediaShowEvent(this, this._jsmpegCanvasElement);
        }
      },
    };

    // Override with user-specified options.
    Object.assign(jsmpegOptions, this.jsmpegConfig?.options);

    return new JSMpeg.VideoElement(
      this,
      url,
      {
        canvas: this._jsmpegCanvasElement,
        hooks: {
          play: () => {
            dispatchPlayEvent(this);
          },
          pause: () => {
            dispatchPauseEvent(this);
          },
        },
      },
      jsmpegOptions,
    );
  }

  /**
   * Reset / destroy the player.
   */
  protected _resetPlayer(): void {
    if (this._refreshPlayerTimerID) {
      window.clearTimeout(this._refreshPlayerTimerID);
      this._refreshPlayerTimerID = undefined;
    }
    if (this._jsmpegVideoPlayer) {
      try {
        this._jsmpegVideoPlayer.destroy();
      } catch (err) {
        // Pass.
      }
      this._jsmpegVideoPlayer = undefined;
    }
    if (this._jsmpegCanvasElement) {
      this._jsmpegCanvasElement.remove();
      this._jsmpegCanvasElement = undefined;
    }
  }

  /**
   * Component connected callback.
   */
  connectedCallback(): void {
    super.connectedCallback();
    if (this.isConnected) {
      this.requestUpdate();
    }
  }

  /**
   * Component disconnected callback.
   */
  disconnectedCallback(): void {
    if (!this.isConnected) {
      this._resetPlayer();
    }
    super.disconnectedCallback();
  }

  /**
   * Refresh the JSMPEG player.
   */
  protected async _refreshPlayer(): Promise<void> {
    this._resetPlayer();

    this._jsmpegCanvasElement = document.createElement('canvas');
    this._jsmpegCanvasElement.className = 'media';

    const url = await this._getURL();
    if (url) {
      this._jsmpegVideoPlayer = this._createJSMPEGPlayer(url);

      this._refreshPlayerTimerID = window.setTimeout(() => {
        this.requestUpdate();
      }, (URL_SIGN_EXPIRY_SECONDS - URL_SIGN_REFRESH_THRESHOLD_SECONDS) * 1000);
    } else {
      dispatchErrorMessageEvent(this, localize('error.jsmpeg_no_sign'));
    }
  }

  /**
   * Master render method.
   */
  protected render(): TemplateResult | void {
    const _render = async (): Promise<TemplateResult | void> => {
      await this._refreshPlayer();

      if (!this._jsmpegVideoPlayer || !this._jsmpegCanvasElement) {
        return dispatchErrorMessageEvent(this, localize('error.jsmpeg_no_player'));
      }
      return html`${this._jsmpegCanvasElement}`;
    };
    return html`${until(_render(), renderProgressIndicator())}`;
  }

  /**
   * Get styles.
   */
  static get styles(): CSSResultGroup {
    return unsafeCSS(liveJSMPEGStyle);
  }
}
