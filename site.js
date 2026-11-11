const menu = document.querySelector(".menu");
const links = document.querySelector(".links");

if (menu && links) {
  const setMenu = (open) => {
    links.classList.toggle("open", open);
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };

  setMenu(false);
  menu.addEventListener("click", () => setMenu(!links.classList.contains("open")));
  links.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && links.classList.contains("open")) {
      setMenu(false);
      menu.focus();
    }
  });
}

const enquiry = document.getElementById("enquiryForm");
const topButton = document.getElementById("topBtn");

if (topButton) {
  const updateTopButton = () => { topButton.hidden = window.scrollY < 500; };
  updateTopButton();
  window.addEventListener("scroll", updateTopButton, { passive: true });
  topButton.addEventListener("click", () => window.scrollTo({ top: 0 }));
}

if (enquiry) {
  enquiry.addEventListener("submit", (event) => {
    event.preventDefault();

    const field = (id) => document.getElementById(id)?.value.trim() || "Not specified";
    const details = [
      "Namaste USOA GROUP,",
      "",
      "Name: " + field("name"),
      "Mobile: " + field("mobile"),
      "Requirement: " + field("requirement"),
      "Quantity: " + field("quantity"),
      "Location: " + field("location"),
      "Message: " + field("message")
    ];
    window.open("https://wa.me/919142703535?text=" + encodeURIComponent(details.join("\n")), "_blank", "noopener,noreferrer");
  });
}

const marketing = document.querySelector(".marketing-page");

if (marketing && "IntersectionObserver" in window &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target;
      if (!element.matches(":focus-within") && !element.querySelector(":target") && !element.closest(":target")) {
        element.classList.add("motion-enter");
      }
      reveal.unobserve(element);
    }
  }, { threshold: 0.08 });

  const groups = marketing.querySelectorAll(".grid2, .grid3, .grid4, .credentials, .facts, .faq, .quick-grid");
  for (const group of groups) {
    const items = group.querySelectorAll(":scope > :is(.card, .fact, .credential, .quick-link, details)");
    items.forEach((item, index) => {
      item.style.setProperty("--motion-delay", Math.min(index, 5) * 45 + "ms");
      reveal.observe(item);
    });
  }

  marketing.querySelectorAll("main :is(.title, .ctaBand .row, .prose > h2, .policy-links), footer .footgrid > div")
    .forEach(element => reveal.observe(element));
}
