import Swiper from '../third_party/swiper/swiper.esm.browser.bundle.min.js'






window.addEventListener('DOMContentLoaded', function () {
    var swiper = new Swiper('.swiper-container', {
        pagination: {
          el: '.swiper-pagination',
          dynamicBullets: true,
        },
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
          },
      });
  })
  