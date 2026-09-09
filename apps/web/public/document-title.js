export const PRODUCT_TITLE = "Seal Harness";

export function sessionDocumentTitle(title, productTitle = PRODUCT_TITLE) {
  return typeof title === "string" && title.length > 0 ? `${title} — ${productTitle}` : productTitle;
}
