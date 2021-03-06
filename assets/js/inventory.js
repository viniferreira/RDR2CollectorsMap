var Inventory = {
  items: {},
  changedItems: [],
  categories: {},
  highlightStyles: { STATIC_RECOMMENDED: 0, STATIC_DEFAULT: 1, ANIMATED_RECOMMENDED: 2, ANIMATED_DEFAULT: 3 },

  init: function () {
    $('#enable-inventory-menu-update').prop("checked", InventorySettings.isMenuUpdateEnabled);
    $('#enable-inventory-popups').prop("checked", InventorySettings.isPopupsEnabled);
    $('#enable-inventory').prop("checked", InventorySettings.isEnabled);
    $('#highlight_low_amount_items').prop("checked", InventorySettings.highlightLowAmountItems);
    $('#highlight_style').val(InventorySettings.highlightStyle);
    $('#inventory-container').toggleClass("opened", InventorySettings.isEnabled);
    $('#inventory-stack').val(InventorySettings.stackSize);
    $('#soft-flowers-inventory-stack').val(InventorySettings.flowersSoftStackSize);
    $('#reset-collection-updates-inventory').prop("checked", InventorySettings.resetButtonUpdatesInventory);
    $('#auto-enable-sold-items').prop("checked", InventorySettings.autoEnableSoldItems);
    $('#reset-inventory-daily').prop("checked", InventorySettings.resetInventoryDaily);
    $('#enable-additional-inventory-options').prop("checked", InventorySettings.enableAdvancedInventoryOptions);


    // disable dropdown menu if highlight low amount items is disabled:
    $('[data-help="highlight_style"]').toggleClass('disabled', !InventorySettings.highlightLowAmountItems);
    $('#highlight_low_amount_items').on('change', function () {
      $('[data-help="highlight_style"]').toggleClass('disabled', !InventorySettings.highlightLowAmountItems);
    });
    $('.collection-value-bottom').toggleClass('hidden', !InventorySettings.enableAdvancedInventoryOptions);
  },

  load: function () {
    Inventory.items = JSON.parse(localStorage.getItem("inventory"));
    if (Inventory.items === null) Inventory.items = {};
  },

  save: function () {
    $.each(MapBase.markers, function (key, marker) {
      if (marker.category == 'random') return;
      Inventory.items[marker.itemId] = marker.amount;
    });

    localStorage.setItem("inventory", JSON.stringify(Inventory.items));

    Inventory.updateLowAmountItems();
  },

  getMovingAverage: function (currentAvg, newVal, numElements) {
    return (currentAvg * numElements + newVal) / (numElements + 1.0);
  },

  updateLowAmountItems: function () {
    if (!InventorySettings.isEnabled || !InventorySettings.highlightLowAmountItems) {
      return;
    }

    // reset category values
    if (Inventory.categories == undefined) {
      Inventory.categories = {};
    }

    var changedCategories = [];

    if (this.changedItems.length == 0) {
      this.changedItems = Object.keys(Inventory.items);
    }

    // build a unique list of categories whose item amounts have changed
    this.changedItems.forEach(itemName => {
      var category = itemName.split("_")[0];
      if (changedCategories.indexOf(category) == -1) {
        changedCategories.push(category);
      }
    });

    // walk through all categories and update the corresponding markers
    changedCategories.forEach(category => {
      Inventory.categories[category] = { max: 0, min: 0, avg: 0.0, numElements: 0 };
      var itemsInThisCategory = Object.keys(Inventory.items).filter(itemName => itemName.startsWith(category));

      itemsInThisCategory.forEach(itemName => {
        var itemAmount = Inventory.items[itemName];

        // compute all category values again
        Inventory.categories[category] = {
          max: Math.max(Inventory.categories[category].max, itemAmount),
          min: Math.min(Inventory.categories[category].min, itemAmount),
          avg: Inventory.getMovingAverage(Inventory.categories[category].avg, parseFloat(itemAmount), Inventory.categories[category].numElements),
          numElements: Inventory.categories[category].numElements + 1
        };
      });

      if (category == "random") return;

      // since items with amount 0 have not been considered before: adjust the average amount with the missing "0" values
      var numItemsInCategory = Collection.collections[category].items.length;
      if (Inventory.categories[category].numElements < numItemsInCategory) {
        Inventory.categories[category].avg = (Inventory.categories[category].avg * Inventory.categories[category].numElements) / numItemsInCategory;
        Inventory.categories[category].numElements = numItemsInCategory;
      }
      // update the category markers
      Inventory.updateLowItemMarkersForCategory(category);
    });

    // clear the change items data
    this.changedItems = [];
  },

  // update the markers of a specified item category
  updateLowItemMarkersForCategory: function (category) {
    // remove all highlight classes at first
    $(`[data-marker*=${category}] > img.marker-contour`).removeClass(function (index, className) {
      return (className.match(/highlight-low-amount-items-\S+/gm) || []).join(' ');
    });
    $(`[data-marker*=${category}] > img.marker-contour`).css('--animation-target-opacity', 0.0);
    $(`[data-marker*=${category}] > img.marker-contour`).css("opacity", 0.0);

    if (Inventory.categories[category] == undefined) {
      Inventory.categories[category] = { min: 0, max: 0, avg: 0, numElements: 0 };
    }

    if (!enabledCategories.includes(category)) return;

    // get all markers which should be highlighted
    var markers = MapBase.markers.filter(_m => _m.category === category && _m.isCurrent);

    // for each marker: calculate the value used for coloring and add/remove the appropriate css class
    markers.map(_m => {
      // Set the correct marker colors depending on the map background.
      // Do this only affected collectible item markers and exclude, e.g. fast travel points or madam nazar
      Inventory.updateMarkerSources(_m);

      // further highlighting should only be done for enabled markers
      if (!_m.canCollect) {
        return;
      }

      var weight = (Inventory.categories[category].avg - parseFloat(_m.amount)) / InventorySettings.stackSize;
      weight = Math.max(weight, 0.0);

      var scaledWeight = Math.min(weight * 2.4, 1.0);

      // set new highlight-low-amount-items class based on current value
      if (weight < 0.02) {
        // no highlights
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('opacity', 0.0);
      }
      else if ((weight < 0.3) || (InventorySettings.highlightStyle < Inventory.highlightStyles.ANIMATED_RECOMMENDED)) { // just static highlights for small differences or if animation is disabled
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('opacity', scaledWeight);
      }
      else { // animated or static highlights for larger differences according to user settings
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('--animation-target-opacity', scaledWeight);
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).addClass(`highlight-low-amount-items-animated`);
      }
    });
  },

  updateMarkerSources: function (marker) {
    var markerBackgroundColor = MapBase.getIconColor(marker);
    var markerContourColor = MapBase.getContourColor(markerBackgroundColor);

    var markerSrc = `./assets/images/icons/marker_${markerBackgroundColor}.png?v=${nocache}`;
    var markerContourSrc = `./assets/images/icons/contours/contour_marker_${markerContourColor}.png?v=${nocache}`;

    // update the contour color
    $(`[data-marker=${marker.text || marker.subdata}] > img.marker-contour`).attr('src', markerContourSrc);
    $(`[data-marker=${marker.text || marker.subdata}] > img.background`).attr('src', markerSrc);
  },

  changeMarkerAmount: function (name, amount, skipInventory = false) {
    var sameItemMarkers = MapBase.markers.filter(marker => marker.legacyItemId === name);

    Inventory.changedItems.push(sameItemMarkers[0].text);

    sameItemMarkers.forEach(marker => {
      if (!skipInventory || skipInventory && InventorySettings.isMenuUpdateEnabled) {
        marker.amount = parseInt(marker.amount) + amount;

        if (marker.amount < 0)
          marker.amount = 0;
      }

      if (!InventorySettings.isEnabled) return;

      const popup = marker.lMarker && marker.lMarker.getPopup();
      if (popup) popup.update();

      $(`[data-type=${name}] .counter-number`)
        .text(marker.amount)
        .toggleClass('text-danger', marker.amount >= InventorySettings.stackSize);

      if ((marker.isCollected ||
        (InventorySettings.isEnabled && marker.amount >= InventorySettings.stackSize)) &&
        marker.isCurrent ||
        (marker.category === 'flower' && marker.amount >= InventorySettings.flowersSoftStackSize)) {
        $(`[data-marker=${marker.text}]`).css('opacity', Settings.markerOpacity / 3);
        $(`[data-type=${marker.legacyItemId}]`).addClass('disabled');
      }
      else if (marker.isCurrent) {
        $(`[data-marker=${marker.text}]`).css('opacity', Settings.markerOpacity);
        $(`[data-type=${marker.legacyItemId}]`).removeClass('disabled');
      }

      if (marker.isCurrent && ['egg', 'flower'].includes(marker.category)) {
        $(`[data-type=${marker.legacyItemId}]`).toggleClass('disabled',
          sameItemMarkers.filter(m => m.cycleName === marker.cycleName).every(m => !m.canCollect));
      }

      Menu.refreshCollectionCounter(marker.category);
    });

    if ($("#routes").val() == 1)
      Routes.drawLines();

    Inventory.save();
    Menu.refreshItemsCounter();
    Menu.refreshWeeklyItems();
  }
};