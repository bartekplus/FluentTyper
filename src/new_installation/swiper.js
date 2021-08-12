import Swiper from "../third_party/swiper/swiper-bundle.esm.browser.js";

window.addEventListener("DOMContentLoaded", function () {
  (() =>
    new Swiper(".swiper-container", {
      pagination: {
        el: ".swiper-pagination",
        dynamicBullets: true,
      },
      navigation: {
        nextEl: ".swiper-button-next",
        prevEl: ".swiper-button-prev",
      },
      simulateTouch: false,
    }))();
});
