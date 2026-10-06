/**
 * CJ Map - 開源地圖與路徑繪製模組 (map.js)
 * 基於 Leaflet.js 與 OpenStreetMap (100% 免費，無需 API Key)
 * 負責標記渲染、自訂圖示、Google 街景跳轉、自由路徑折線繪製與地圖邊界縮放
 */

class CJMapController {
  constructor(containerId = 'leaflet-map') {
    this.containerId = containerId;
    this.map = null;

    // 圖層管理群組 (Layer Groups)
    this.searchLayer = null;
    this.favoriteLayer = null;
    this.journeyMarkersLayer = null;
    this.journeyPathsLayer = null;
    this.drawingLayer = null;

    // 路徑繪製狀態
    this.isDrawing = false;
    this.activeDrawingItem = null;
    this.activeDrawingPolyline = null;
    this.onPathUpdatedCallback = null;

    // 快顯右鍵選單暫存座標
    this.contextLatLng = null;

    // 獨立子視窗（雙螢幕街景）與當前街景點暫存
    this.svPopoutWindow = null;
    this.currentSvLocation = null;

    // 獨立路線規劃子視窗（圖 2 完整版，支援即時刷新與雙螢幕）
    this.directionsPopoutWindow = null;

    this.initMap();
  }

  /**
   * 初始化地圖
   */
  initMap() {
    // 預設台北 101 座標 [25.03416, 121.56465], Zoom: 15 (對應原 Python mapview.py)
    this.map = L.map(this.containerId, {
      center: [25.03416, 121.56465],
      zoom: 15,
      zoomControl: true
    });

    // 載入 Google Maps 瓦片圖層 (繁體中文、路名清晰、完全相容本地 file:// 存取，與原 Python 版相同)
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=zh-TW&x={x}&y={y}&z={z}', {
      subdomains: '0123',
      maxZoom: 20,
      attribution: '&copy; Google Maps'
    }).addTo(this.map);

    // 建立管理圖層
    this.searchLayer = L.layerGroup().addTo(this.map);
    this.favoriteLayer = L.layerGroup().addTo(this.map);
    this.journeyMarkersLayer = L.layerGroup().addTo(this.map);
    this.journeyPathsLayer = L.layerGroup().addTo(this.map);
    this.drawingLayer = L.layerGroup().addTo(this.map);

    // 註冊地圖事件
    this.bindMapEvents();
  }

  /**
   * 註冊地圖滑鼠與互動事件
   */
  bindMapEvents() {
    // 1. 地圖點擊 (路徑繪製模式中)
    this.map.on('click', (e) => {
      if (this.isDrawing && this.activeDrawingItem) {
        const coord = [Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))];
        this.activeDrawingItem.path_list.push(coord);

        // 更新折線畫面
        this.renderDrawingPolyline();

        // 即時計算距離與預估時間
        if (typeof this.onPathUpdatedCallback === 'function') {
          this.onPathUpdatedCallback(this.activeDrawingItem);
        }
      }
      this.hideContextMenu();
    });

    // 2. 地圖右鍵點擊 (反查經緯度與地址)
    this.map.on('contextmenu', (e) => {
      this.contextLatLng = e.latlng;
      this.showContextMenu(e);
    });

    // 3. 移動或縮放時關閉右鍵選單
    this.map.on('movestart zoomstart', () => {
      this.hideContextMenu();
    });

    // 4. 綁定懸浮街景關閉按鈕
    const svCloseBtn = document.getElementById('btn-sv-close');
    if (svCloseBtn) {
      svCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeStreetView();
      });
    }

    // 5. 綁定懸浮街景獨立子視窗按鈕 (支援拖曳到第二螢幕雙螢幕使用)
    const svPopoutBtn = document.getElementById('btn-sv-popout');
    if (svPopoutBtn) {
      svPopoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.popoutStreetView();
      });
    }

    // 6. 綁定懸浮街景視窗拖曳功能
    this.initFloatingWindowDrag();
  }

  /**
   * 初始化懸浮街景視窗的拖曳功能
   */
  initFloatingWindowDrag() {
    const floatWin = document.getElementById('floating-streetview');
    if (!floatWin) return;
    const header = floatWin.querySelector('.floating-window-header');
    const mapContainer = document.getElementById('map-container');
    if (!header || !mapContainer) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onStart = (clientX, clientY, target) => {
      // 點擊標題列中的按鈕（全螢幕或關閉）時不觸發拖曳
      if (target.closest('button')) return false;

      isDragging = true;
      floatWin.classList.add('dragging');
      startX = clientX;
      startY = clientY;

      const rect = floatWin.getBoundingClientRect();
      const containerRect = mapContainer.getBoundingClientRect();

      // 計算目前相對地圖容器的 left / top
      initialLeft = rect.left - containerRect.left;
      initialTop = rect.top - containerRect.top;

      // 切換為 left / top 絕對定位，移除 bottom / right 預設錨定
      floatWin.style.bottom = 'auto';
      floatWin.style.right = 'auto';
      floatWin.style.left = `${initialLeft}px`;
      floatWin.style.top = `${initialTop}px`;
      return true;
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging) return;

      const dx = clientX - startX;
      const dy = clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // 邊界防護：限制在 map-container 範圍內，保留邊緣各 10px
      const maxLeft = mapContainer.clientWidth - floatWin.offsetWidth - 10;
      const maxTop = mapContainer.clientHeight - floatWin.offsetHeight - 10;

      newLeft = Math.max(10, Math.min(newLeft, maxLeft));
      newTop = Math.max(10, Math.min(newTop, maxTop));

      floatWin.style.left = `${newLeft}px`;
      floatWin.style.top = `${newTop}px`;
    };

    const onEnd = () => {
      if (isDragging) {
        isDragging = false;
        floatWin.classList.remove('dragging');
      }
    };

    // 滑鼠事件
    header.addEventListener('mousedown', (e) => {
      if (onStart(e.clientX, e.clientY, e.target)) {
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      onMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', onEnd);

    // 觸控事件支援
    header.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (onStart(touch.clientX, touch.clientY, e.target)) {
          e.preventDefault();
        }
      }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        const touch = e.touches[0];
        onMove(touch.clientX, touch.clientY);
      }
    }, { passive: true });

    document.addEventListener('touchend', onEnd);
  }

  /**
   * 建立 Leaflet 自訂圖標 (使用 icons/ 目錄的 458 個圖示)
   */
  createCustomIcon(iconCode = '750') {
    const code = iconCode || '750';
    const iconUrl = `icons/${code}.png`;

    return L.icon({
      iconUrl: iconUrl,
      iconSize: [26, 26],
      iconAnchor: [13, 26],     // 針尖位於下方中心
      popupAnchor: [0, -26],
      className: 'custom-map-pin'
    });
  }

  /**
   * 地圖右下角懸浮子母視窗顯示街景與實景 (無需 API Key，不開啟新瀏覽器分頁)
   */
  openStreetView(lat, lng, title = '') {
    if (!lat || !lng) return;

    this.currentSvLocation = { lat, lng, title };
    const embedUrl = `https://maps.google.com/maps?q=${lat},${lng}&layer=c&cbll=${lat},${lng}&cbp=12,0,0,0,0&output=svembed`;

    // 若獨立子視窗處於開啟狀態（例如已拖移至第二個螢幕），自動同步切換該視窗的街景！
    if (this.svPopoutWindow && !this.svPopoutWindow.closed) {
      window.open(embedUrl, 'CJMapStreetViewPopout');
      return;
    }

    const floatWin = document.getElementById('floating-streetview');
    const titleEl = document.getElementById('floating-sv-title');
    const iframe = document.getElementById('floating-sv-iframe');
    const openTabBtn = document.getElementById('btn-sv-open-tab');

    if (!floatWin || !iframe) {
      window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`, '_blank');
      return;
    }

    if (titleEl) {
      titleEl.textContent = `📍 ${title || '地點街景預覽'}`;
    }

    // 內嵌 Google 街景實景 (免 API Key)
    iframe.src = embedUrl;

    // 綁定右上角另開全螢幕按鈕
    if (openTabBtn) {
      openTabBtn.onclick = (e) => {
        e.stopPropagation();
        window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`, '_blank');
      };
    }

    floatWin.style.display = 'flex';
  }

  /**
   * 彈出為獨立子視窗（支援拖曳至第二螢幕雙螢幕使用）
   */
  popoutStreetView() {
    if (!this.currentSvLocation) return;
    const { lat, lng } = this.currentSvLocation;
    const embedUrl = `https://maps.google.com/maps?q=${lat},${lng}&layer=c&cbll=${lat},${lng}&cbp=12,0,0,0,0&output=svembed`;

    // 彈出獨立子視窗 (設定寬高，瀏覽器會以獨立系統視窗開啟而非分頁)
    this.svPopoutWindow = window.open(
      embedUrl,
      'CJMapStreetViewPopout',
      'width=800,height=550,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
    );

    // 關閉網頁內部的浮動視窗，釋放主螢幕視野
    this.closeStreetView();
  }

  /**
   * 關閉懸浮街景視窗
   */
  closeStreetView() {
    const floatWin = document.getElementById('floating-streetview');
    const iframe = document.getElementById('floating-sv-iframe');
    if (floatWin) {
      floatWin.style.display = 'none';
      // 關閉時重設回右下角預設定位
      floatWin.style.left = '';
      floatWin.style.top = '';
      floatWin.style.right = '20px';
      floatWin.style.bottom = '20px';
    }
    if (iframe) iframe.src = '';
  }

  /**
   * 開啟獨立 Google Maps 路線規劃視窗 (顯示圖 2 完整版，支援多方案、票價、時刻表與細節設定)
   * 尺寸與位置精準對齊右側地圖區域，剛好覆蓋地圖且高度與瀏覽器貼齊，方便對照左側中間日程抄錄
   */
  openDirections(originStr, destStr, travelMode = 'transit') {
    if (!originStr || !destStr) return;

    const mode = CJ_CONSTANTS.MOVE_WAY_MAP[travelMode] || travelMode || 'transit';
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=${mode}`;

    // 取得右側地圖面板的座標與尺寸，精準覆蓋右側地圖範圍 (如同使用者手動調整的圖 2 效果)
    const rightPanel = document.getElementById('right-panel');
    const rect = rightPanel ? rightPanel.getBoundingClientRect() : null;

    const winX = window.screenX !== undefined ? window.screenX : (window.screenLeft || 0);
    const winY = window.screenY !== undefined ? window.screenY : (window.screenTop || 0);

    let left, top, width, height;

    if (rect) {
      // 左邊界精準貼齊右側地圖面板起點，寬度貼合地圖，高度與主瀏覽器視窗一致
      left = Math.round(winX + rect.left);
      top = Math.round(winY);
      width = Math.max(850, Math.round(rect.width));
      height = Math.round(window.outerHeight || window.innerHeight || 850);
    } else {
      width = 960;
      height = Math.round(window.outerHeight || 850);
      left = Math.max(0, (window.screen.availWidth || 1440) - width);
      top = winY;
    }

    const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no`;

    // 以固定視窗名稱 'CJMapDirectionsPopout' 開啟，重複點擊自動在同一視窗刷新路線，不開新分頁
    this.directionsPopoutWindow = window.open(url, 'CJMapDirectionsPopout', windowFeatures);

    if (this.directionsPopoutWindow) {
      try {
        this.directionsPopoutWindow.focus();
      } catch (e) {}
    }
  }

  // ==========================================
  // 圖層渲染：搜尋結果、口袋名單、旅程標記、折線
  // ==========================================

  /**
   * 渲染搜尋結果標記
   */
  renderSearchMarkers(placesArray) {
    this.searchLayer.clearLayers();
    if (!Array.isArray(placesArray)) return;

    placesArray.forEach(place => {
      if (place.place_lat && place.place_lng) {
        const marker = L.marker([place.place_lat, place.place_lng], {
          icon: this.createCustomIcon(CJ_CONSTANTS.DEFAULT_ICONS.SEARCH),
          title: place.place_nickname || place.place_name
        });

        // Hover 浮動地名
        marker.bindTooltip(place.place_nickname || place.place_name, {
          permanent: false,
          direction: 'top',
          className: 'custom-tooltip'
        });

        // 點擊開啟右下角懸浮街景
        marker.on('click', () => {
          this.openStreetView(place.place_lat, place.place_lng, place.place_nickname || place.place_name);
        });

        this.searchLayer.addLayer(marker);
      }
    });
  }

  /**
   * 清空搜尋標記
   */
  clearSearchMarkers() {
    this.searchLayer.clearLayers();
  }

  /**
   * 渲染口袋清單標記
   */
  renderFavoriteMarkers(favoritesArray, isVisible = true) {
    this.favoriteLayer.clearLayers();
    if (!isVisible || !Array.isArray(favoritesArray)) return;

    favoritesArray.forEach(place => {
      if (place.place_lat && place.place_lng) {
        const marker = L.marker([place.place_lat, place.place_lng], {
          icon: this.createCustomIcon(CJ_CONSTANTS.DEFAULT_ICONS.FAVORITE),
          title: place.place_nickname || place.place_name
        });

        marker.bindTooltip(place.place_nickname || place.place_name, {
          permanent: false,
          direction: 'top',
          className: 'custom-tooltip'
        });

        marker.on('click', () => {
          this.openStreetView(place.place_lat, place.place_lng, place.place_nickname || place.place_name);
        });

        this.favoriteLayer.addLayer(marker);
      }
    });
  }

  /**
   * 渲染旅程每日項目（起點、終點標記與路徑折線）
   */
  renderJourney(daysArray) {
    this.journeyMarkersLayer.clearLayers();
    this.journeyPathsLayer.clearLayers();

    if (!Array.isArray(daysArray)) return;

    daysArray.forEach(day => {
      // 若該日設定為隱藏，則不渲染其標記與路徑
      if (!day.show_on_map || !Array.isArray(day.items)) return;

      day.items.forEach(item => {
        if (item.type === 'move') {
          // 出發地標記
          const s = item.placemodel_start;
          if (s && s.place_lat && s.place_lng) {
            this._addJourneyMarker(s, `${s.place_nickname || '出發點'}`);
          }
          // 抵達地標記
          const e = item.placemodel_end;
          if (e && e.place_lat && e.place_lng) {
            this._addJourneyMarker(e, `${e.place_nickname || '抵達點'}`);
          }
        } else if (item.type === 'stay') {
          // 停留點標記
          const s = item.placemodel_start;
          if (s && s.place_lat && s.place_lng) {
            this._addJourneyMarker(s, `${s.place_nickname || '停留點'}`);
          }
        } else if (item.type === 'path') {
          // 自由繪製路徑折線
          if (Array.isArray(item.path_list) && item.path_list.length > 1) {
            const colorHex = CJ_CONSTANTS.COLOR_DICT[item.color] || '#212121';
            const polyline = L.polyline(item.path_list, {
              color: colorHex,
              weight: 4,
              opacity: 0.85,
              smoothFactor: 1
            });

            polyline.bindTooltip(`${item.path_name || '路徑'} (${item.distance.toFixed(2)} km)`, {
              sticky: true,
              className: 'custom-tooltip'
            });

            this.journeyPathsLayer.addLayer(polyline);
          }
        }
      });
    });
  }

  _addJourneyMarker(placeModel, defaultLabel) {
    const marker = L.marker([placeModel.place_lat, placeModel.place_lng], {
      icon: this.createCustomIcon(placeModel.place_icon || '750'),
      title: placeModel.place_nickname || defaultLabel
    });

    marker.bindTooltip(placeModel.place_nickname || defaultLabel, {
      permanent: false,
      direction: 'top',
      className: 'custom-tooltip'
    });

    marker.on('click', () => {
      this.openStreetView(placeModel.place_lat, placeModel.place_lng, placeModel.place_nickname || defaultLabel);
    });

    this.journeyMarkersLayer.addLayer(marker);
  }

  // ==========================================
  // 自由路徑繪製工具 (對應 journeypathitem.py)
  // ==========================================

  /**
   * 開始繪製路徑
   */
  startDrawingPath(pathModel, onUpdateCallback) {
    this.isDrawing = true;
    this.activeDrawingItem = pathModel;
    this.onPathUpdatedCallback = onUpdateCallback;

    // 切換地圖游標為十字準心
    this.map.getContainer().style.cursor = 'crosshair';

    this.renderDrawingPolyline();
  }

  /**
   * 暫停繪製路徑
   */
  pauseDrawingPath() {
    this.isDrawing = false;
    this.map.getContainer().style.cursor = '';
  }

  /**
   * 撤回上一個點 (返回上一步)
   */
  undoDrawingPoint() {
    if (!this.activeDrawingItem || !this.activeDrawingItem.path_list) return;

    if (this.activeDrawingItem.path_list.length > 0) {
      this.activeDrawingItem.path_list.pop();
      this.renderDrawingPolyline();

      if (typeof this.onPathUpdatedCallback === 'function') {
        this.onPathUpdatedCallback(this.activeDrawingItem);
      }
    }
  }

  /**
   * 完成繪製路徑
   */
  finishDrawingPath() {
    this.pauseDrawingPath();
    this.drawingLayer.clearLayers();
    this.activeDrawingPolyline = null;
    this.activeDrawingItem = null;
  }

  /**
   * 即時更新當前繪製中的暫存折線
   */
  renderDrawingPolyline() {
    this.drawingLayer.clearLayers();
    if (!this.activeDrawingItem || !this.activeDrawingItem.path_list) return;

    const coords = this.activeDrawingItem.path_list;
    if (coords.length > 0) {
      const colorHex = CJ_CONSTANTS.COLOR_DICT[this.activeDrawingItem.color] || '#d32f2f';

      // 繪製折線
      if (coords.length > 1) {
        this.activeDrawingPolyline = L.polyline(coords, {
          color: colorHex,
          weight: 4,
          dashArray: this.isDrawing ? '6, 6' : null, // 繪製中呈現虛線
          opacity: 0.9
        }).addTo(this.drawingLayer);
      }

      // 繪製各節點的小圓圈，方便視覺觀察
      coords.forEach((pt, index) => {
        L.circleMarker(pt, {
          radius: index === coords.length - 1 ? 5 : 3,
          color: colorHex,
          fillColor: '#ffffff',
          fillOpacity: 1,
          weight: 2
        }).addTo(this.drawingLayer);
      });
    }
  }

  // ==========================================
  // 地圖視野自適應縮放 (layout_map)
  // ==========================================

  /**
   * 自動縮放地圖包覆指定座標列表
   */
  layoutMap(coordsArray) {
    if (!Array.isArray(coordsArray) || coordsArray.length === 0) return;

    const validCoords = coordsArray.filter(c => c && c[0] !== null && c[1] !== null && !isNaN(c[0]) && !isNaN(c[1]));
    if (validCoords.length === 0) return;

    if (validCoords.length === 1) {
      this.map.setView(validCoords[0], 15, { animate: true });
    } else {
      const bounds = L.latLngBounds(validCoords);
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
    }
  }

  /**
   * 縮放至全部可見旅程與口袋名單
   */
  fitAllJourneyAndFavorites(dataCenter) {
    const coords = [];

    // 口袋名單座標
    if (dataCenter.show_favorite && Array.isArray(dataCenter.favorite_places)) {
      dataCenter.favorite_places.forEach(p => {
        if (p.place_lat && p.place_lng) coords.push([p.place_lat, p.place_lng]);
      });
    }

    // 旅程項目座標
    if (Array.isArray(dataCenter.journey_days)) {
      dataCenter.journey_days.forEach(day => {
        if (day.show_on_map && Array.isArray(day.items)) {
          day.items.forEach(item => {
            if (item.type === 'move') {
              if (item.placemodel_start?.place_lat) coords.push([item.placemodel_start.place_lat, item.placemodel_start.place_lng]);
              if (item.placemodel_end?.place_lat) coords.push([item.placemodel_end.place_lat, item.placemodel_end.place_lng]);
            } else if (item.type === 'stay') {
              if (item.placemodel_start?.place_lat) coords.push([item.placemodel_start.place_lat, item.placemodel_start.place_lng]);
            } else if (item.type === 'path' && Array.isArray(item.path_list)) {
              item.path_list.forEach(pt => coords.push(pt));
            }
          });
        }
      });
    }

    this.layoutMap(coords);
  }

  /**
   * 縮放至口袋名單範圍
   */
  fitFavorites(favoritesArray) {
    const coords = [];
    if (Array.isArray(favoritesArray)) {
      favoritesArray.forEach(p => {
        if (p.place_lat && p.place_lng) coords.push([p.place_lat, p.place_lng]);
      });
    }
    this.layoutMap(coords);
  }

  /**
   * 縮放至指定一日的範圍
   */
  fitDay(day) {
    const coords = [];
    if (day && Array.isArray(day.items)) {
      day.items.forEach(item => {
        if (item.type === 'move') {
          if (item.placemodel_start?.place_lat) coords.push([item.placemodel_start.place_lat, item.placemodel_start.place_lng]);
          if (item.placemodel_end?.place_lat) coords.push([item.placemodel_end.place_lat, item.placemodel_end.place_lng]);
        } else if (item.type === 'stay') {
          if (item.placemodel_start?.place_lat) coords.push([item.placemodel_start.place_lat, item.placemodel_start.place_lng]);
        } else if (item.type === 'path' && Array.isArray(item.path_list)) {
          item.path_list.forEach(pt => coords.push(pt));
        }
      });
    }
    this.layoutMap(coords);
  }

  // ==========================================
  // 右鍵選單快顯與反查地址
  // ==========================================

  showContextMenu(event) {
    const menu = document.getElementById('map-context-menu');
    if (!menu) return;

    const lat = event.latlng.lat.toFixed(6);
    const lng = event.latlng.lng.toFixed(6);
    const btn = document.getElementById('btn-context-search');
    if (btn) {
      btn.textContent = `📍 搜尋此座標 (${lat}, ${lng})`;
    }

    menu.style.left = `${event.containerPoint.x + 10}px`;
    menu.style.top = `${event.containerPoint.y + 10}px`;
    menu.style.display = 'block';
  }

  hideContextMenu() {
    const menu = document.getElementById('map-context-menu');
    if (menu) {
      menu.style.display = 'none';
    }
  }

  /**
   * 免費反查經緯度地址 (使用 OpenStreetMap Nominatim 服務)
   */
  async reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' }
      });
      if (!res.ok) throw new Error('反查地址失敗');
      const data = await res.json();
      return {
        name: data.name || data.display_name?.split(',')[0] || `座標點 (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        address: data.display_name || '',
        lat: Number(lat),
        lng: Number(lng)
      };
    } catch (e) {
      console.warn('反查地址異常', e);
      return {
        name: `座標點 (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        address: `經度: ${lng}, 緯度: ${lat}`,
        lat: Number(lat),
        lng: Number(lng)
      };
    }
  }
}

// 導出全局實例類別
window.CJMapController = CJMapController;
