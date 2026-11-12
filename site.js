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


/* USOA business email directory — public-facing addresses are forwarded to the verified business inbox. */
(function setupBusinessEmailDirectory() {
  const site = document.body;
  if (!site || !site.classList.contains("marketing-page")) return;

  const desks = [
    { label: "General contact", address: "contact@usoagroup.in", detail: "General questions and business correspondence.", symbol: "✉" },
    { label: "Product enquiries", address: "enquiry@usoagroup.in", detail: "Honey, bee products, specifications and trade enquiries.", symbol: "◇" },
    { label: "Sales & wholesale", address: "sales@usoagroup.in", detail: "Quotations, wholesale orders and commercial supply.", symbol: "↗" },
    { label: "Customer support", address: "customersupport@usoagroup.in", detail: "Orders, delivery updates and customer assistance.", symbol: "☏" },
    { label: "Help & support", address: "support@usoagroup.in", detail: "Website, account and general help requests.", symbol: "?" },
    { label: "Company information", address: "info@usoagroup.in", detail: "Company information and corporate introductions.", symbol: "i" },
    { label: "Administration", address: "admin@usoagroup.in", detail: "Official documents and administrative correspondence.", symbol: "▣" }
  ];

  const byAddress = Object.fromEntries(desks.map((desk) => [desk.address, desk]));
  const card = (desk, compact) =>
    '<a class="uso-email-card' + (compact ? ' uso-email-card-compact' : '') + '" href="mailto:' + desk.address + '">' +
      (compact ? '' : '<span class="uso-email-symbol" aria-hidden="true">' + desk.symbol + '</span>') +
      '<span class="uso-email-copy"><strong>' + desk.label + '</strong>' +
      '<span class="uso-email-address">' + desk.address + '</span>' +
      (compact ? '' : '<span class="uso-email-description">' + desk.detail + '</span>') +
      '</span><span class="uso-email-arrow" aria-hidden="true">↗</span></a>';

  // Show the domain address publicly while retaining the existing Gmail forwarding destination.
  site.querySelectorAll('a[href="mailto:usoagroup@gmail.com"]').forEach((link) => {
    link.href = "mailto:contact@usoagroup.in";
    if (link.textContent.trim().toLowerCase() === "usoagroup@gmail.com") {
      link.textContent = "contact@usoagroup.in";
    }
  });

  const page = (window.location.pathname.split("/").pop() || "index.html").split(".")[0].toLowerCase();
  const pageContent = {
    index: { heading: "Email our business desks", intro: "For enquiries, quotations and assistance, use the appropriate email address.", emails: ["contact@usoagroup.in", "enquiry@usoagroup.in", "sales@usoagroup.in", "support@usoagroup.in"] },
    products: { heading: "Product & wholesale enquiries", intro: "Ask about specifications, availability, quantities and commercial pricing.", emails: ["enquiry@usoagroup.in", "sales@usoagroup.in"] },
    services: { heading: "Business & trade enquiries", intro: "Share your supply requirements or request a wholesale quotation.", emails: ["enquiry@usoagroup.in", "sales@usoagroup.in"] },
    about: { heading: "Company correspondence", intro: "Reach the right address for information and official matters.", emails: ["info@usoagroup.in", "admin@usoagroup.in"] },
    faq: { heading: "Need more assistance?", intro: "Contact our customer care and website support addresses.", emails: ["customersupport@usoagroup.in", "support@usoagroup.in"] },
    contact: { heading: "Contact the right desk", intro: "Choose the email address that best matches your request.", emails: desks.map((desk) => desk.address), full: true }
  };

  const config = pageContent[page];
  const main = site.querySelector("main");
  if (main && config && !site.querySelector(".uso-email-directory")) {
    const section = document.createElement("section");
    section.className = "section " + (page === "index" || page === "contact" ? "soft" : "white") + " uso-email-directory";
    if (page === "contact") section.id = "email-directory";
    section.setAttribute("aria-label", config.heading);
    section.innerHTML =
      '<div class="container"><div class="title">' +
      '<p class="eyebrow">USOA GROUP · Business email</p><h2>' + config.heading + '</h2><p>' + config.intro + '</p></div>' +
      '<div class="uso-email-grid' + (config.full ? '' : ' uso-email-grid-compact') + '">' +
        config.emails.map((email) => card(byAddress[email], !config.full)).join("") +
      '</div>' +
      (config.full ? '' : '<p class="uso-email-all"><a href="contact.html#email-directory">View all department email addresses →</a></p>') +
      '</div>';
    main.appendChild(section);
  }

  const footer = site.querySelector("footer");
  if (footer && !footer.querySelector(".uso-footer-email")) {
    const contacts = document.createElement("div");
    contacts.className = "container uso-footer-email";
    contacts.setAttribute("aria-label", "Business email addresses");
    contacts.innerHTML =
      '<strong>Business email</strong>' +
      '<a href="mailto:contact@usoagroup.in">Contact</a>' +
      '<a href="mailto:sales@usoagroup.in">Sales</a>' +
      '<a href="mailto:support@usoagroup.in">Support</a>' +
      '<a href="contact.html#email-directory">All email contacts →</a>';
    footer.appendChild(contacts);
  }
})();
