async function fetchProductCatalogue() {
  const response = await fetch("/api/products", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error("The catalogue is unavailable.");
  const data = await response.json();
  if (!data.success || !Array.isArray(data.products)) throw new Error("The catalogue is unavailable.");
  return new Map(data.products.filter(product =>
    typeof product.id === "string" && typeof product.name === "string" &&
    Number.isFinite(product.amount) && product.amount > 0
  ).map(product => [product.id, product]));
}

const catalogueCards = document.querySelectorAll("[data-catalogue-product]");
const catalogueCurrency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

if (catalogueCards.length) {
  fetchProductCatalogue().then(products => {
    catalogueCards.forEach(card => {
      const product = products.get(card.dataset.catalogueProduct);
      if (!product) return;
      const price = catalogueCurrency.format(product.amount);
      card.querySelector("[data-catalogue-price]").textContent = price;
      card.querySelector(".product-link").textContent = "Buy now · " + price + " →";
    });
  }).catch(() => { /* Keep the existing catalogue available while the service is offline. */ });
}
