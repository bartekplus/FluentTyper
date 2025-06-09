//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/bartekplus/fancier-settings
// License: LGPL v2.1
//

import { ElementWrapper } from "./utils.js";

class Bundle {
  constructor(creator) {
    this.creator = creator;

    // Create DOM elements
    this.tabA = new ElementWrapper("a");
    this.tabLi = new ElementWrapper("li");
    this.tabA.inject(this.tabLi);
    this.content = new ElementWrapper("div", {
      class: "content-tab is-hidden",
    });

    // Create event handlers
    this.tabA.addEvent("click", this.activate.bind(this));
  }

  activate() {
    if (this.creator.activeBundle && this.creator.activeBundle !== this) {
      this.creator.activeBundle.deactivate();
    }

    this.tabLi.element.classList.add("is-active");
    this.content.element.classList.remove("is-hidden");
    this.creator.activeBundle = this;
  }

  deactivate() {
    this.tabLi.element.classList.remove("is-active");
    this.content.element.classList.add("is-hidden");
    this.creator.activeBundle = null;
  }
}

class Tab {
  constructor(tabContainer, tabContentContainer) {
    this.tabContainer = tabContainer;
    this.tabContentContainer = tabContentContainer;
    this.activeBundle = null;
  }

  create() {
    const bundle = new Bundle(this);
    bundle.tabLi.inject(this.tabContainer);
    bundle.content.inject(this.tabContentContainer);
    if (!this.activeBundle) {
      bundle.activate();
    }
    return bundle;
  }
}

export { Tab };
