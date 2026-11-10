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
