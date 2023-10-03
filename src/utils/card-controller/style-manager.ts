import { setPerformanceCSSStyles } from '../../performance';
import { FrigateCardConfig } from '../../types';
import { View } from '../../view/view';
import { setOrRemoveAttribute } from '../basic';
import { CardStyleAPI } from './types';

export class StyleManager {
  protected _api: CardStyleAPI;

  constructor(api: CardStyleAPI) {
    this._api = api;
  }

  public setLightOrDarkMode(): void {
    const config = this._api.getConfigManager().getConfig();
    const isDarkMode =
      config?.view.dark_mode === 'on' ||
      (config?.view.dark_mode === 'auto' &&
        (!this._api.getInteractionManager().hasInteraction() ||
          !!this._api.getHASSManager().getHASS()?.themes.darkMode));

    setOrRemoveAttribute(
      this._api.getCardElementManager().getElement(),
      isDarkMode,
      'dark',
    );
  }

  public setExpandedMode(): void {
    const card = this._api.getCardElementManager().getElement();
    const view = this._api.getViewManager().getView();

    // When a new media loads, set the aspect ratio for when the card is
    // expanded/popped-up. This is based exclusively on last media content,
    // as dimension configuration does not apply in fullscreen or expanded mode.
    const lastKnown = this._api.getMediaLoadedInfoManager().getLastKnown();
    card.style.setProperty(
      '--frigate-card-expand-aspect-ratio',
      view?.isAnyMediaView() && lastKnown
        ? `${lastKnown.width} / ${lastKnown.height}`
        : 'unset',
    );
    // Non-media may have no intrinsic dimensions (or multiple media items in a
    // grid) and so we need to explicit request the dialog to use all available
    // space.
    const isGrid = view?.isGrid();
    card.style.setProperty(
      '--frigate-card-expand-width',
      !isGrid && view?.isAnyMediaView()
        ? 'none'
        : 'var(--frigate-card-expand-max-width)',
    );
    card.style.setProperty(
      '--frigate-card-expand-height',
      !isGrid && view?.isAnyMediaView()
        ? 'none'
        : 'var(--frigate-card-expand-max-height)',
    );
  }

  public setMinMaxHeight(): void {
    const config = this._api.getConfigManager().getConfig();
    if (config) {
      const card = this._api.getCardElementManager().getElement();
      card.style.setProperty('--frigate-card-min-height', config.dimensions.min_height);
      card.style.setProperty('--frigate-card-max-height', config.dimensions.max_height);
    }
  }

  public setPerformance(): void {
    setPerformanceCSSStyles(
      this._api.getCardElementManager().getElement(),
      this._api.getConfigManager().getCardWideConfig()?.performance,
    );
  }

  protected _isAspectRatioEnforced(
    config: FrigateCardConfig,
    view?: View | null,
  ): boolean {
    const aspectRatioMode = config.dimensions.aspect_ratio_mode;

    // Do not artifically constrain aspect ratio if:
    // - It's fullscreen.
    // - It's in expanded mode.
    // - Aspect ratio enforcement is disabled.
    // - Aspect ratio enforcement is dynamic and it's a media view (i.e. not the
    //   gallery) or diagnostics / timeline.
    return !(
      this._api.getFullscreenManager().isInFullscreen() ||
      this._api.getExpandManager().isExpanded() ||
      aspectRatioMode === 'unconstrained' ||
      (aspectRatioMode === 'dynamic' &&
        (!view ||
          view?.isAnyMediaView() ||
          view?.is('timeline') ||
          view?.is('diagnostics')))
    );
  }

  /**
   * Get the aspect ratio padding required to enforce the aspect ratio (if it is
   * required).
   * @returns A padding percentage.
   */
  public getAspectRatioStyle(): string {
    const config = this._api.getConfigManager().getConfig();
    const view = this._api.getViewManager().getView();

    if (config) {
      if (!this._isAspectRatioEnforced(config, view)) {
        return 'auto';
      }

      const aspectRatioMode = config.dimensions.aspect_ratio_mode;

      const lastKnown = this._api.getMediaLoadedInfoManager().getLastKnown();
      if (lastKnown && aspectRatioMode === 'dynamic') {
        return `${lastKnown.width} / ${lastKnown.height}`;
      }

      return `${config.dimensions.aspect_ratio[0]} / ${config.dimensions.aspect_ratio[1]}`;
    }
    return '16 / 9';
  }
}
