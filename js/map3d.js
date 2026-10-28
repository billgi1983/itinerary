/**
 * CJ Map - 開源 3D 地圖與立體建築模組 (map3d.js)
 * 基於 MapLibre GL JS 與 OpenFreeMap Liberty 向量圖資 (100% 免費、免 API Key、免信用卡)
 * 具備 60° 傾斜視角、3D 建物拔高模型 (Fill Extrusion)、羅盤旋轉與航拍視角
 */

class CJMap3DController {
  constructor(containerId = 'maplibre-3d-map') {
    this.containerId = containerId;
    this.map = null;
    this.isInitialized = false;
    this.markers = [];
    this.pathSourceIds = [];
    this.onMarkerClickCallback = null;
    this.initialPitch = 60;        // 預設俯瞰傾斜 60 度，立體感最強
    this.initialBearing = -17.6;    // 預設微偏視角
  }

  /**
   * 初始化 MapLibre 3D 地圖實例 (採延遲載入，初次切換時才啟動 WebGL)
   * @param {number} lat - 緯度
   * @param {number} lng - 經度
   * @param {number} zoom - 縮放級別
   * @param {Function} onReady - 初始化完成回呼函式
   */
  initMap(lat = 25.03416, lng = 121.56465, zoom = 15.5, onReady = null) {
    if (this.isInitialized && this.map) {
      this.map.resize();
      if (onReady) onReady();
      return;
    }

    if (typeof maplibregl === 'undefined') {
      console.error('MapLibre GL JS 尚未載入');
      return;
    }

    // 初始化 3D 地圖 (注意 MapLibre 座標順序為 [經度 lng, 緯度 lat])
    this.map = new maplibregl.Map({
      container: this.containerId,
      style: 'https://tiles.openfreemap.org/styles/liberty', // OpenFreeMap Liberty 內建 3D 建築資料
      center: [lng, lat],
      zoom: zoom,
      pitch: this.initialPitch,
      bearing: this.initialBearing,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true }
    });

    // 加入右上角立體羅盤與視角傾斜控制項
    this.map.addControl(new maplibregl.NavigationControl({
      visualizePitch: true,
      showCompass: true,
      showZoom: true
    }), 'top-right');

    this.map.on('load', () => {
      this.isInitialized = true;
      this.ensure3DBuildings();
      this.map.resize();
      if (onReady) onReady();
    });
  }

  /**
   * 確保 3D 建物填色立體圖層 (3D Fill Extrusion) 啟用
   */
  ensure3DBuildings() {
    if (!this.map) return;

    const layers = this.map.getStyle().layers || [];
    const has3D = layers.some(l => l.type === 'fill-extrusion');

    if (!has3D) {
      let labelLayerId = null;
      for (const layer of layers) {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
          labelLayerId = layer.id;
          break;
        }
      }

      if (!this.map.getLayer('custom-3d-buildings')) {
        this.map.addLayer({
          id: 'custom-3d-buildings',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'render_height'],
              0, '#2b303c',
              50, '#383f4f',
              120, '#464f62',
              250, '#535e75'
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0,
              14.5, ['get', 'render_height']
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13, 0,
              14.5, ['get', 'render_min_height']
            ],
            'fill-extrusion-opacity': 0.88
          }
        }, labelLayerId);
      }
    }
  }

  /**
   * 清除所有 3D 地圖標記
   */
  clearMarkers() {
    this.markers.forEach(m => m.remove());
    this.markers = [];
  }

  /**
   * 清除所有 3D 路徑折線
   */
  clearPaths() {
    if (!this.map || !this.map.isStyleLoaded()) return;
    this.pathSourceIds.forEach(id => {
      try {
        if (this.map.getLayer(`layer-${id}`)) this.map.removeLayer(`layer-${id}`);
        if (this.map.getSource(id)) this.map.removeSource(id);
      } catch (e) {}
    });
    this.pathSourceIds = [];
  }

  /**
   * 渲染旅程規劃的所有標記與路徑 (同步自 DataCenter.journey_days)
   * @param {Array<JourneyDay>} daysArray 
   */
  renderJourney(daysArray) {
    if (!this.map || !this.isInitialized) return;

    this.clearMarkers();
    this.clearPaths();

    if (!Array.isArray(daysArray)) return;

    daysArray.forEach(day => {
      if (!day.show_on_map || !Array.isArray(day.items)) return;

      day.items.forEach(item => {
        if (item.type === 'move') {
          // 出發地標記
          const s = item.placemodel_start;
          if (s && s.place_lat && s.place_lng) {
            this.addPlaceMarker(s, s.place_nickname || '出發點');
          }
          // 抵達地標記
          const e = item.placemodel_end;
          if (e && e.place_lat && e.place_lng) {
            this.addPlaceMarker(e, e.place_nickname || '抵達點');
          }
        } else if (item.type === 'stay') {
          // 停留點標記
          const s = item.placemodel_start;
          if (s && s.place_lat && s.place_lng) {
            this.addPlaceMarker(s, s.place_nickname || '停留點');
          }
        } else if (item.type === 'path') {
          // 自由繪製路徑折線
          if (Array.isArray(item.path_list) && item.path_list.length > 1) {
            this.draw3DPolyline(item);
          }
        }
      });
    });
  }

  /**
   * 渲染口袋名單標記 (同步自 DataCenter.favorite_places)
   * @param {Array<PlaceModel>} favoritesArray 
   * @param {boolean} isVisible 
   */
  renderFavorites(favoritesArray, isVisible = true) {
    if (!this.map || !this.isInitialized) return;
    if (!isVisible || !Array.isArray(favoritesArray)) return;

    favoritesArray.forEach(place => {
      if (place && place.place_lat && place.place_lng) {
        this.addPlaceMarker(place, place.place_nickname || '口袋名單', true);
      }
    });
  }

  /**
   * 渲染地點搜尋結果標記
   * @param {Array<PlaceModel>} searchResults 
   */
  renderSearchResults(searchResults) {
    if (!this.map || !this.isInitialized) return;
    if (!Array.isArray(searchResults)) return;

    searchResults.forEach(place => {
      if (place && place.place_lat && place.place_lng) {
        this.addPlaceMarker(place, place.place_nickname || place.place_name);
      }
    });
  }

  /**
   * 建立單一自訂圖示標記並加入 3D 地圖
   * @param {PlaceModel} place 
   * @param {string} badgeText 
   * @param {boolean} isFavorite 
   */
  addPlaceMarker(place, badgeText = '', isFavorite = false) {
    if (!place || !place.place_lat || !place.place_lng || !this.map) return;

    const el = document.createElement('div');
    el.className = 'marker-3d-container';
    el.style.cursor = 'pointer';

    const iconCode = place.place_icon || (isFavorite ? '760' : '750');
    const label = place.place_nickname || place.place_name || badgeText;

    // 建立 3D 浮立標記外觀
    el.innerHTML = `
      <div class="marker-3d-pin" title="${this.escapeHtml(label)}">
        <img src="icons/${iconCode}.png" alt="icon" class="marker-3d-img">
        <span class="marker-3d-badge">${this.escapeHtml(label)}</span>
      </div>
    `;

    // 點擊事件：通知外部開啟懸浮街景
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onMarkerClickCallback) {
        this.onMarkerClickCallback(place.place_lat, place.place_lng, label);
      }
    });

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([place.place_lng, place.place_lat])
      .addTo(this.map);

    this.markers.push(marker);
  }

  /**
   * 繪製 3D 空間路徑折線
   * @param {JourneyPathModel} pathItem 
   */
  draw3DPolyline(pathItem) {
    if (!this.map || !Array.isArray(pathItem.path_list) || pathItem.path_list.length < 2) return;

    // 將 Leaflet [lat, lng] 轉換為 MapLibre [lng, lat]
    const coordinates = pathItem.path_list
      .filter(p => Array.isArray(p) && p.length >= 2 && p[0] !== null && p[1] !== null)
      .map(p => [p[1], p[0]]);

    if (coordinates.length < 2) return;

    const sourceId = `path-source-${Math.random().toString(36).substring(2, 9)}`;
    const layerId = `layer-${sourceId}`;

    const hexColor = (typeof CJ_CONSTANTS !== 'undefined' && CJ_CONSTANTS.COLOR_DICT && CJ_CONSTANTS.COLOR_DICT[pathItem.color])
      ? CJ_CONSTANTS.COLOR_DICT[pathItem.color]
      : '#3b82f6';

    try {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        }
      });

      this.map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': hexColor,
          'line-width': 5,
          'line-opacity': 0.88
        }
      });

      this.pathSourceIds.push(sourceId);
    } catch (err) {
      console.warn('繪製 3D 路徑失敗：', err);
    }
  }

  /**
   * 平滑飛行縮放至指定經緯度
   */
  flyTo(lat, lng, zoom = 16) {
    if (!this.map) return;
    this.map.flyTo({
      center: [lng, lat],
      zoom: zoom,
      pitch: this.initialPitch,
      bearing: this.initialBearing,
      essential: true
    });
  }

  /**
   * 自適應顯示所有座標範圍
   * @param {Array<[number, number]>} latLngList - [[lat, lng], ...]
   */
  fitBounds(latLngList) {
    if (!this.map || !latLngList || latLngList.length === 0) return;

    const valid = latLngList.filter(c => c && c[0] !== null && c[1] !== null && !isNaN(c[0]) && !isNaN(c[1]));
    if (valid.length === 0) return;

    if (valid.length === 1) {
      this.flyTo(valid[0][0], valid[0][1], 16);
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    valid.forEach(([lat, lng]) => {
      bounds.extend([lng, lat]);
    });

    this.map.fitBounds(bounds, {
      padding: { top: 80, bottom: 60, left: 60, right: 60 },
      pitch: 50,
      maxZoom: 17
    });
  }

  /**
   * 取得當前中心點與縮放度 (以便同步回 Leaflet 2D)
   */
  getCenterAndZoom() {
    if (!this.map) return null;
    const center = this.map.getCenter();
    return {
      lat: center.lat,
      lng: center.lng,
      zoom: this.map.getZoom()
    };
  }

  /**
   * 重新計算地圖容器尺寸 (切換顯示時必備)
   */
  resize() {
    if (this.map) {
      this.map.resize();
    }
  }

  /**
   * 簡單 HTML 跳脫防止 XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
