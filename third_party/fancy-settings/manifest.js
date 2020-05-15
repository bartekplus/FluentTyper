// SAMPLE
this.manifest = {
    "name": "FluentBoard Settings",
    "icon": "icon/icon128.png",
    "settings": [{
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "enable",
            "type": "checkbox",
            "label": i18n.get("enable")
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "showIcon",
            "type": "checkbox",
            "label": i18n.get("showIcon")
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "showPlaceHolders",
            "type": "checkbox",
            "label": i18n.get("showPlaceHolders")
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "unBlockActiveTabs",
            "type": "checkbox",
            "label": i18n.get("unBlockActiveTabs")
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderColor",
            "type": "text",
            "label": i18n.get("placeHolderColor"),
            "text": i18n.get("x-placeHolderColor"),
            "colorPicker": true,
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderOpacity",
            "type": "text",
            "label": i18n.get("placeHolderOpacity"),
            "text": i18n.get("x-placeHolderOpacity"),
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderColorHover",
            "type": "text",
            "label": i18n.get("placeHolderColorHover"),
            "text": i18n.get("x-placeHolderColorHover"),
            "colorPicker": true,
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderOpacityHover",
            "type": "text",
            "label": i18n.get("placeHolderOpacityHover"),
            "text": i18n.get("x-placeHolderOpacityHover"),
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderIcon",
            "type": "checkbox",
            "label": i18n.get("placeHolderIcon"),
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("Placeholder"),
            "name": "placeHolderIconUrl",
            "type": "text",
            "label": i18n.get("placeHolderIconUrl"),
        },

        {
            "tab": "White List",
            "group": i18n.get("Management"),
            "name": "whiteListBox",
            "type": "listBox",
            //"label": "Soup 2 should be:",
            "options": function () {
                return;
            }()
        }, {
            "tab": "White List",
            "group": i18n.get("Management"),
            "name": "removeDomainBtn",
            "type": "button",
            "text": i18n.get("remove")
        }, {
            "tab": "White List",
            "group": i18n.get("add"),
            "name": "domain",
            "type": "text",
            "label": i18n.get("domain"),
            "text": i18n.get("x-domain"),
            "store": false
        }, {
            "tab": "White List",
            "group": i18n.get("add"),
            "name": "addDomainBtn",
            "type": "button",
            "text": i18n.get("add")
        }, {
            "tab": i18n.get("White List"),
            "group": i18n.get("add"),
            "name": "addDomainDsc",
            "type": "description",
            "text": i18n.get("description-url")
        }, {
            "tab": i18n.get("About"),
            "group": i18n.get("FluentBoard"),
            "name": "FluentBoard",
            "type": "description",
            "text": i18n.get("x-FluentBoard")
        }, {
            "tab": i18n.get("About"),
            "group": i18n.get("Credits"),
            "name": "Credits",
            "type": "description",
            "text": i18n.get("x-Credits")
        },

    ],

};
