export const MODAL_SIZE = 'lg';

/**
 * The modal body scrolls, so an autocomplete popup rendered inside it is
 * clipped at the modal's edge. Portal it to the document body instead.
 */
export const TOOLTIP_PORTAL_TARGET =
  typeof document !== 'undefined' ? document.body : null;
