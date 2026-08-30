
const menu=document.querySelector(".menu"), links=document.querySelector(".links");
if(menu) menu.addEventListener("click",()=>links.classList.toggle("open"));
document.querySelectorAll(".links a").forEach(a=>a.addEventListener("click",()=>links.classList.remove("open")));
const form=document.querySelector("#enquiryForm");
if(form) form.addEventListener("submit",e=>{
  e.preventDefault();
  const g=id=>document.getElementById(id)?.value.trim()||"Not specified";
  const msg=`Namaste USOA GROUP,\n\nName: ${g("name")}\nMobile: ${g("mobile")}\nRequirement: ${g("requirement")}\nQuantity: ${g("quantity")}\nLocation: ${g("location")}\nMessage: ${g("message")}`;
  window.open("https://wa.me/919142703535?text="+encodeURIComponent(msg),"_blank");
});
