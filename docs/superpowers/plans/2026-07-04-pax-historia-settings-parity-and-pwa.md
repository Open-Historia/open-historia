# Pax Historia 설정 패널 정합 + PWA 설치 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** open-paxhistoria의 설정 패널에 실제 Pax Historia에 있는 지도 상호작용 토글 4개와 크기 슬라이더 3개, 그리고 민감한 국기 흐림 처리 기능을 추가하고, 앱을 홈 화면/데스크톱에 설치 가능한 PWA로 만든다.

**Architecture:** 새 `src/runtime/mapSettings.js` 모듈이 localStorage 기반 설정값을 관리하고 `window.dispatchEvent(new Event("mapSettings:updated"))`로 변경을 알린다(기존 `runtime/i18n.js`의 `"i18n:updated"` 이벤트와 동일한 컨벤션). `World.jsx`/`Nations.jsx`/`GlobeEffects.jsx`는 이 이벤트를 구독해 각자 필요한 값만 반영한다 — `GameUI/main.jsx`를 거치는 새 prop 체인을 만들지 않는다(기존 여러 컴포넌트를 건드리는 대신, 설정을 실제로 쓰는 지도 관련 파일들만 수정).

**Tech Stack:** React 19, MapLibre GL JS 5.19(react-map-gl 8.1 래퍼), ffmpeg(PWA 아이콘 생성용, PATH에 이미 설치되어 있음 확인).

## Global Constraints

- 자동화된 테스트 스위트 없음(확인 완료) — 모든 검증은 `npm run build` + `npm run lint` 통과 + 수동 브라우저 확인.
- 기존 코드 스타일(인라인 style 객체, 함수형 컴포넌트, 영어 주석) 유지.
- 각 태스크 = 1커밋, 빌드+린트 통과 후 커밋.
- **범위 제외** (근거 없이 추측 구현하지 않기 위해 명시적으로 제외):
  - "기능 크기(절대적)" 슬라이더 — 코드베이스에 대응하는 "줌에 무관한 고정 크기" 개념이 존재하지 않고(Units.jsx/Cities.jsx 모두 zoom-interpolated), Pax Historia 소스 없이는 정확한 의미를 알 수 없음. "기능 크기(상대적)"만 구현.
  - "이벤트 애니메이션 비활성화" — 이 앱에는 특정 "이벤트 애니메이션"으로 명확히 지목할 단일 요소가 없고(여러 UI에 흩어진 hover/transition 효과뿐), 잘못 추측하면 무관한 UI를 대량으로 건드리게 됨.
  - Pax Historia의 AI/어드바이저 설정 UX(자체 관리형 AI 티어 시스템) — 사업 모델 자체가 다른 BYOK 오픈소스 프로젝트에는 이식할 대상이 아님.

---

## Task 1: `mapSettings.js` 런타임 모듈 생성

**Files:**
- Create: `src/runtime/mapSettings.js`

**Interfaces:**
- Produces: `getMapSetting(key)`, `setMapSetting(key, value)`, `MAP_SETTING_KEYS`(객체, 아래 8개 키), `"mapSettings:updated"` window 이벤트(payload 없음, 리스너가 각자 `getMapSetting`으로 재조회)

- [ ] **Step 1: 모듈 작성**

```js
/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers (World.jsx, Nations.jsx,
// GlobeEffects.jsx) listen for "mapSettings:updated" instead of receiving
// these as props threaded through GameUI/main.jsx, mirroring how
// runtime/i18n.js dispatches "i18n:updated".

export const MAP_SETTING_KEYS = {
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    reverseScrollZoom: "map_reverse_scroll_zoom",
    disablePanInertia: "map_disable_pan_inertia",
    zoomSensitivity: "map_zoom_sensitivity",
    borderWidth: "map_border_width",
    featureSize: "map_feature_size",
    blurSensitiveFlags: "map_blur_sensitive_flags",
};

const BOOLEAN_KEYS = new Set([
    MAP_SETTING_KEYS.hideCountryLabels,
    MAP_SETTING_KEYS.disableIdleRotation,
    MAP_SETTING_KEYS.reverseScrollZoom,
    MAP_SETTING_KEYS.disablePanInertia,
    MAP_SETTING_KEYS.blurSensitiveFlags,
]);

const NUMBER_DEFAULTS = {
    [MAP_SETTING_KEYS.zoomSensitivity]: 1,
    [MAP_SETTING_KEYS.borderWidth]: 1,
    [MAP_SETTING_KEYS.featureSize]: 1,
};

export function getMapSetting(key) {
    if (BOOLEAN_KEYS.has(key)) {
        return localStorage.getItem(key) === "1";
    }

    const raw = localStorage.getItem(key);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : NUMBER_DEFAULTS[key];
}

export function setMapSetting(key, value) {
    if (BOOLEAN_KEYS.has(key)) {
        localStorage.setItem(key, value ? "1" : "0");
    } else {
        localStorage.setItem(key, String(value));
    }

    window.dispatchEvent(new Event("mapSettings:updated"));
}
```

- [ ] **Step 2: 빌드/린트 확인**

```bash
npm run build
npm run lint
```
둘 다 통과해야 함(이 파일을 아직 아무도 import하지 않으므로 실행 동작 변화는 없음).

- [ ] **Step 3: 커밋**

```bash
git add src/runtime/mapSettings.js
git commit -m "feat(map): 지도 설정을 관리하는 mapSettings 런타임 모듈 추가"
```

---

## Task 2: 설정 UI — 토글 4개 + 슬라이더 3개 + 민감한 국기 드롭다운

**Files:**
- Modify: `src/Game/GameUI/settings.jsx`

**Interfaces:**
- Consumes: `getMapSetting`, `setMapSetting`, `MAP_SETTING_KEYS` (Task 1)
- Produces: 없음 (UI만 추가, Task 3~6이 각자 `mapSettings.js`를 직접 구독하므로 이 UI와 별개로 동작함 — 이 태스크만으로 이미 설정값 저장/조회는 완결됨)

**배경**: `settings.jsx`의 `SettingsMenu` 컴포넌트는 이미 `Toggle`(라벨+on/off 스위치) 컴포넌트를 갖고 있다(198-237행). 새 슬라이더용 컴포넌트가 없으므로 하나 추가한다.

- [ ] **Step 1: 슬라이더 컴포넌트 추가**

`src/Game/GameUI/settings.jsx`에서 기존 `Toggle` 컴포넌트 정의(237행) 바로 다음에 추가:

```jsx
const Slider = ({ label, value, min, max, step, onChange }) => (
    <div style={{ marginBottom: "1rem" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.35rem" }}>
    <span style={{ fontSize: "0.9rem" }}>{label}</span>
    <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)" }}>{value}</span>
    </div>
    <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={(event) => onChange(Number(event.target.value))}
    style={{ width: "100%", cursor: "pointer" }}
    />
    </div>
);
```

- [ ] **Step 2: import 추가**

파일 최상단 import 블록(1-16행)에 추가:

```jsx
import {
    MAP_SETTING_KEYS,
    getMapSetting,
    setMapSetting,
} from "../../runtime/mapSettings.js";
```

- [ ] **Step 3: `SettingsMenu` 내부에 새 섹션 추가**

`SettingsMenu` 컴포넌트(645행 부근) 안, 기존 `<Toggle label="3D Terrain" .../>`(725행)와 `<ComingSoonToggle label="Country borders" .../>`(726행) 사이에 새 섹션을 끼워 넣는다. 상태는 `SettingsMenu` 함수 본문 최상단에서 `useState`로 초기화한다 — `SettingsMenu`가 이미 `import React, { useEffect, useState } from "react";`를 쓰고 있으므로 추가 import 불필요:

`SettingsMenu = ({ ... }) => {` 함수 본문 시작 부분(662행 `const selectedProvider = apiProvider ?? DEFAULT_PROVIDER;` 다음 줄)에 추가:

```jsx
    const [mapSettings, setMapSettingsState] = useState(() => ({
        hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
        disableIdleRotation: getMapSetting(MAP_SETTING_KEYS.disableIdleRotation),
        reverseScrollZoom: getMapSetting(MAP_SETTING_KEYS.reverseScrollZoom),
        disablePanInertia: getMapSetting(MAP_SETTING_KEYS.disablePanInertia),
        zoomSensitivity: getMapSetting(MAP_SETTING_KEYS.zoomSensitivity),
        borderWidth: getMapSetting(MAP_SETTING_KEYS.borderWidth),
        featureSize: getMapSetting(MAP_SETTING_KEYS.featureSize),
        blurSensitiveFlags: getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags),
    }));

    const updateMapSetting = (stateKey, settingKey, value) => {
        setMapSetting(settingKey, value);
        setMapSettingsState((current) => ({ ...current, [stateKey]: value }));
    };
```

그리고 `<Toggle label="3D Terrain" .../>` 다음, `<ComingSoonToggle .../>` 이전에 삽입:

```jsx
        <div style={{ margin: "0.5rem 0 1rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: "0.84rem", fontWeight: 700, marginBottom: "0.6rem" }}>Map interaction</div>
        <Toggle
        label="Hide country labels"
        enabled={mapSettings.hideCountryLabels}
        onToggle={() => updateMapSetting("hideCountryLabels", MAP_SETTING_KEYS.hideCountryLabels, !mapSettings.hideCountryLabels)}
        />
        <Toggle
        label="Disable idle globe rotation"
        enabled={mapSettings.disableIdleRotation}
        onToggle={() => updateMapSetting("disableIdleRotation", MAP_SETTING_KEYS.disableIdleRotation, !mapSettings.disableIdleRotation)}
        />
        <Toggle
        label="Reverse scroll zoom direction"
        enabled={mapSettings.reverseScrollZoom}
        onToggle={() => updateMapSetting("reverseScrollZoom", MAP_SETTING_KEYS.reverseScrollZoom, !mapSettings.reverseScrollZoom)}
        />
        <Toggle
        label="Disable pan inertia"
        enabled={mapSettings.disablePanInertia}
        onToggle={() => updateMapSetting("disablePanInertia", MAP_SETTING_KEYS.disablePanInertia, !mapSettings.disablePanInertia)}
        />
        <Slider
        label="Zoom sensitivity"
        value={mapSettings.zoomSensitivity}
        min={0.5}
        max={3}
        step={0.25}
        onChange={(value) => updateMapSetting("zoomSensitivity", MAP_SETTING_KEYS.zoomSensitivity, value)}
        />
        <Slider
        label="Border width"
        value={mapSettings.borderWidth}
        min={0.25}
        max={3}
        step={0.25}
        onChange={(value) => updateMapSetting("borderWidth", MAP_SETTING_KEYS.borderWidth, value)}
        />
        <Slider
        label="Feature size"
        value={mapSettings.featureSize}
        min={0.25}
        max={3}
        step={0.25}
        onChange={(value) => updateMapSetting("featureSize", MAP_SETTING_KEYS.featureSize, value)}
        />
        <Toggle
        label="Blur sensitive flags"
        enabled={mapSettings.blurSensitiveFlags}
        onToggle={() => updateMapSetting("blurSensitiveFlags", MAP_SETTING_KEYS.blurSensitiveFlags, !mapSettings.blurSensitiveFlags)}
        />
        </div>
```

- [ ] **Step 4: 로컬 구동 후 확인**

설정 메뉴를 열어 새 섹션("Map interaction")이 3D Terrain 토글과 "Country borders"(coming soon) 사이에 보이는지, 슬라이더를 움직이면 숫자가 갱신되는지, 토글을 눌러도 에러가 없는지 확인(이 태스크만으로는 지도에 아직 반영되지 않음 — Task 4~7에서 연결).

- [ ] **Step 5: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 6: 커밋**

```bash
git add src/Game/GameUI/settings.jsx
git commit -m "feat(ui): 설정 패널에 지도 상호작용 토글 4개와 크기 슬라이더 3개 추가"
```

---

## Task 3: 국가 라벨 숨기기 + 기능 크기(상대적) 반영

**Files:**
- Modify: `src/Game/Map/Nations.jsx`

**Interfaces:**
- Consumes: `getMapSetting(MAP_SETTING_KEYS.hideCountryLabels)`, `getMapSetting(MAP_SETTING_KEYS.featureSize)` (Task 1), `"mapSettings:updated"` 이벤트
- Produces: 없음

**배경**: `pointLabelLayerLayout`/`curvedLabelLayerLayout`(711-733행 부근, 정확한 최신 라인은 파일에서 재확인)이 `buildCountryTextSize(1, isGlobe)`를 호출한다. 두 번째 인자는 이미 존재하는 `multiplier` 파라미터 자리 — 여기에 `featureSize` 설정값을 곱하면 된다. 라벨 숨기기는 두 `Layer`의 `layout.visibility`를 `"none"`으로 바꾸면 된다(MapLibre 표준 방식, 소스/데이터는 그대로 두고 렌더만 끔).

- [ ] **Step 1: import 추가**

`Nations.jsx` 최상단 import 블록에 추가:

```js
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";
```

- [ ] **Step 2: 설정 구독 상태 추가**

`WorldMap` 컴포넌트(`const WorldMap = ({ isGlobe = false }) => {`) 본문 최상단에 추가:

```jsx
  const [mapDisplaySettings, setMapDisplaySettings] = useState(() => ({
    hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
    featureSize: getMapSetting(MAP_SETTING_KEYS.featureSize),
  }));

  useEffect(() => {
    const onUpdated = () => setMapDisplaySettings({
      hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
      featureSize: getMapSetting(MAP_SETTING_KEYS.featureSize),
    });
    window.addEventListener("mapSettings:updated", onUpdated);
    return () => window.removeEventListener("mapSettings:updated", onUpdated);
  }, []);
```

(`useState`/`useEffect`는 이미 파일 상단에서 import되어 있음 — 확인 완료.)

- [ ] **Step 3: `buildCountryTextSize` 호출에 featureSize 반영**

`pointLabelLayerLayout`/`curvedLabelLayerLayout`의 `useMemo` 안, `"text-size": buildCountryTextSize(1, isGlobe),`를 각각 아래로 교체하고 의존성 배열에 `mapDisplaySettings.featureSize` 추가:

```jsx
  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(mapDisplaySettings.featureSize, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.featureSize, mapDisplaySettings.hideCountryLabels]);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(mapDisplaySettings.featureSize, isGlobe),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
    visibility: mapDisplaySettings.hideCountryLabels ? "none" : "visible",
  }), [isGlobe, mapDisplaySettings.featureSize, mapDisplaySettings.hideCountryLabels]);
```

- [ ] **Step 4: 로컬 구동 후 확인**

설정에서 "Hide country labels" 켜기 → 지도에서 국가명이 사라지는지 확인 → 끄면 다시 보이는지 확인. "Feature size" 슬라이더를 0.25/3으로 각각 바꿔가며 라벨 크기가 작아지고/커지는지 확인.

- [ ] **Step 5: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 6: 커밋**

```bash
git add src/Game/Map/Nations.jsx
git commit -m "feat(map): 국가 라벨 숨기기 토글과 기능 크기 슬라이더를 지도에 연결"
```

---

## Task 4: 경계선 두께 슬라이더 반영

**Files:**
- Modify: `src/Game/Map/Nations.jsx`

**Interfaces:**
- Consumes: `getMapSetting(MAP_SETTING_KEYS.borderWidth)` (Task 1), Task 3에서 이미 추가된 `mapSettings:updated` 구독 패턴 재사용
- Produces: 없음

**배경**: Task 3에서 이미 `mapDisplaySettings` state와 이벤트 구독을 만들어 두었으므로, 여기에 `borderWidth` 필드만 추가한다. `countriesOutlinePaint`(693행 부근)의 `"line-width": 1`과 `regionsOutlinePaint`(703행 부근)의 `"line-width": ["interpolate", ...]`에 배수를 곱한다. 커스텀(에디터) 지도의 국경선(`custom-regions-outline` 등)은 이번 범위에서 건드리지 않는다 — 스톡 지도가 대다수 사용자가 보는 화면이고, 커스텀 지도 국경은 Part B에서와 동일하게 "손대지 않는다" 원칙을 유지한다.

- [ ] **Step 1: Task 3의 state/effect에 `borderWidth` 추가**

Task 3에서 만든 두 곳(초기 `useState`와 `useEffect`의 업데이트 함수) 모두에 `borderWidth: getMapSetting(MAP_SETTING_KEYS.borderWidth),`를 추가한다. 최종 형태:

```jsx
  const [mapDisplaySettings, setMapDisplaySettings] = useState(() => ({
    hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
    featureSize: getMapSetting(MAP_SETTING_KEYS.featureSize),
    borderWidth: getMapSetting(MAP_SETTING_KEYS.borderWidth),
  }));

  useEffect(() => {
    const onUpdated = () => setMapDisplaySettings({
      hideCountryLabels: getMapSetting(MAP_SETTING_KEYS.hideCountryLabels),
      featureSize: getMapSetting(MAP_SETTING_KEYS.featureSize),
      borderWidth: getMapSetting(MAP_SETTING_KEYS.borderWidth),
    });
    window.addEventListener("mapSettings:updated", onUpdated);
    return () => window.removeEventListener("mapSettings:updated", onUpdated);
  }, []);
```

- [ ] **Step 2: `countriesOutlinePaint`/`regionsOutlinePaint`에 배수 적용**

```jsx
  const countriesOutlinePaint = {
    "line-color": "#000",
    "line-width": mapDisplaySettings.borderWidth,
    "line-opacity": showStockCountries ? 1 : 0,
  };
  const regionsOutlinePaint = {
    "line-color": "#000",
    "line-width": ["*", mapDisplaySettings.borderWidth, ["interpolate", ["linear"], ["zoom"], 3, 0.2, 8, 0.6, 12, 1.0]],
    "line-opacity": worldKnown
      ? ["interpolate", ["linear"], ["zoom"], 5.5, 0, 6.5, 0.6, 8, 0.7]
      : 0,
  };
```

(둘 다 매 렌더마다 재계산되는 일반 객체라 `useMemo`가 아니었음 — 기존 코드 그대로, 새 곱셈만 추가.)

- [ ] **Step 3: 로컬 구동 후 확인**

"Border width" 슬라이더를 0.25/3으로 바꿔가며 국경선이 얇아지고/두꺼워지는지 확인.

- [ ] **Step 4: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 5: 커밋**

```bash
git add src/Game/Map/Nations.jsx
git commit -m "feat(map): 경계선 두께 슬라이더를 스톡 국가/지역 국경에 연결"
```

---

## Task 5: 슬라이드(자동 공전) 카메라 비활성화 토글

**Files:**
- Modify: `src/Game/Map/GlobeEffects.jsx`

**Interfaces:**
- Consumes: `getMapSetting(MAP_SETTING_KEYS.disableIdleRotation)` (Task 1)
- Produces: 없음

**배경**: `GlobeEffects`의 `tick()` 함수 안 `if (idle && !mapInstance.isMoving())` 블록이 자동 공전을 수행한다. 이 조건에 설정값을 추가로 검사한다. 설정이 이펙트 실행 중간에 바뀌어도 반영되도록 `useEffect`의 의존성 배열에 넣어 재실행되게 한다.

- [ ] **Step 1: import 추가**

`GlobeEffects.jsx` 최상단에 추가:

```js
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";
```

- [ ] **Step 2: 설정 구독 상태 추가**

`GlobeEffects` 컴포넌트(`const GlobeEffects = ({ active }) => {`) 본문에서 기존 `const [sunLngState, setSunLngState] = useState(() => sunWorldLng ?? 0);` 다음 줄에 추가:

```jsx
  const [autoRotateDisabled, setAutoRotateDisabled] = useState(
    () => getMapSetting(MAP_SETTING_KEYS.disableIdleRotation),
  );

  useEffect(() => {
    const onUpdated = () => setAutoRotateDisabled(getMapSetting(MAP_SETTING_KEYS.disableIdleRotation));
    window.addEventListener("mapSettings:updated", onUpdated);
    return () => window.removeEventListener("mapSettings:updated", onUpdated);
  }, []);
```

- [ ] **Step 3: `tick()`의 자동 공전 조건에 반영**

기존 메인 `useEffect(() => { ... }, [active, map])`의 의존성 배열을 `[active, map, autoRotateDisabled]`로 바꾸고, 그 안의 `tick` 함수를 수정:

```jsx
    const tick = (now) => {
      const dt = now - lastTick;
      lastTick = now;
      const idle = now - lastInteraction > INTERACTION_GRACE_MS;
      if (idle && !autoRotateDisabled && !mapInstance.isMoving()) {
        const center = mapInstance.getCenter();
        mapInstance.jumpTo({ center: [center.lng - ROTATION_DEG_PER_MS * dt, center.lat] });
      }
      frameId = requestAnimationFrame(tick);
    };
```

- [ ] **Step 4: 로컬 구동 후 확인**

3D Globe 켜고 지도를 조작하지 않은 채 몇 초 기다려 자동 공전이 일어나는지 확인 → 설정에서 "Disable idle globe rotation" 켜기 → 다시 몇 초 기다려 더 이상 자동으로 돌지 않는지 확인.

- [ ] **Step 5: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 6: 커밋**

```bash
git add src/Game/Map/GlobeEffects.jsx
git commit -m "feat(map): 글로브 자동 공전(슬라이드 카메라) 비활성화 토글 추가"
```

---

## Task 6: 줌 감도 + 스크롤 방향 반전 + 팬 관성 비활성화

**Files:**
- Modify: `src/Game/Map/World.jsx`

**Interfaces:**
- Consumes: `getMapSetting(MAP_SETTING_KEYS.zoomSensitivity/reverseScrollZoom/disablePanInertia)` (Task 1)
- Produces: 없음

**배경** (사전 검증 완료, `node_modules/maplibre-gl/dist/maplibre-gl.d.ts` 직접 확인):
- `map.scrollZoom.setWheelZoomRate(rate)`(마우스 휠 기본 1/450)와 `map.scrollZoom.setZoomRate(rate)`(트랙패드 기본 1/100)는 MapLibre의 공식 API. `rate`에 **음수**를 넣으면 줌 방향이 그대로 반전된다(내부적으로 `delta * rate`로 줌량을 계산하는 구조라 부호를 반전시키면 방향이 뒤집힘) — 별도의 wheel 이벤트 가로채기 없이 반전을 구현할 수 있는 가장 낮은 리스크의 방법.
- `dragPan`은 `boolean | {linearity, easing, deceleration, maxSpeed}`를 받는다. `maxSpeed: 0`을 주면 드래그를 놓은 뒤의 관성(코스팅) 속도 상한이 0이 되어 사실상 관성이 없어진다.
- react-map-gl의 `<Map>`은 `scrollZoom` 배율을 선언적 prop으로 지원하지 않으므로(활성화 여부만 boolean/옵션으로 받음), 줌 감도·반전은 `mapRef`로 실제 maplibre 인스턴스를 얻어 `useEffect`에서 명령형으로 설정해야 한다. `dragPan`은 이미 JSX prop이므로 선언적으로 처리한다.

- [ ] **Step 1: import 추가**

`World.jsx` 최상단에 추가(이미 `useCallback, useMemo, useRef`를 import하고 있음 — `useEffect`, `useState` 추가):

```jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

그리고:

```js
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";
```

- [ ] **Step 2: 설정 구독 상태 추가**

`function World({ mapRef, projection, terrainEnabled, onInitialIdle }) {` 본문 최상단(`const hasReportedInitialIdleRef = useRef(false);` 다음 줄)에 추가:

```jsx
  const [interactionSettings, setInteractionSettings] = useState(() => ({
    zoomSensitivity: getMapSetting(MAP_SETTING_KEYS.zoomSensitivity),
    reverseScrollZoom: getMapSetting(MAP_SETTING_KEYS.reverseScrollZoom),
    disablePanInertia: getMapSetting(MAP_SETTING_KEYS.disablePanInertia),
  }));

  useEffect(() => {
    const onUpdated = () => setInteractionSettings({
      zoomSensitivity: getMapSetting(MAP_SETTING_KEYS.zoomSensitivity),
      reverseScrollZoom: getMapSetting(MAP_SETTING_KEYS.reverseScrollZoom),
      disablePanInertia: getMapSetting(MAP_SETTING_KEYS.disablePanInertia),
    });
    window.addEventListener("mapSettings:updated", onUpdated);
    return () => window.removeEventListener("mapSettings:updated", onUpdated);
  }, []);

  // MapLibre's scroll-zoom rate has no declarative prop — only the imperative
  // handler exposes it. A negative rate flips zoom direction with no custom
  // wheel-event handling needed (see plan doc for the verified API).
  useEffect(() => {
    const map = mapRef?.current?.getMap?.();
    if (!map) return;
    const sign = interactionSettings.reverseScrollZoom ? -1 : 1;
    map.scrollZoom.setWheelZoomRate((1 / 450) * interactionSettings.zoomSensitivity * sign);
    map.scrollZoom.setZoomRate((1 / 100) * interactionSettings.zoomSensitivity * sign);
  }, [mapRef, interactionSettings.zoomSensitivity, interactionSettings.reverseScrollZoom]);
```

- [ ] **Step 3: `dragPan` prop을 선언적으로 계산**

현재 `<Map ... dragPan ... >`(160행 부근)을 아래로 교체:

```jsx
        dragPan={interactionSettings.disablePanInertia ? { maxSpeed: 0 } : true}
```

- [ ] **Step 4: 로컬 구동 후 확인**

- "Zoom sensitivity"를 3으로 올리고 마우스 휠 스크롤 → 평소보다 훨씬 빠르게 줌되는지 확인. 0.5로 내리면 느려지는지 확인.
- "Reverse scroll zoom direction" 켜기 → 휠을 위로 굴리면 줌아웃, 아래로 굴리면 줌인되는지(평소와 반대) 확인.
- "Disable pan inertia" 켜고 지도를 빠르게 드래그했다가 놓기 → 평소처럼 미끄러지듯 계속 움직이지 않고 즉시 멈추는지 확인.

- [ ] **Step 5: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 6: 커밋**

```bash
git add src/Game/Map/World.jsx
git commit -m "feat(map): 줌 감도, 스크롤 방향 반전, 팬 관성 비활성화 설정 연결"
```

---

## Task 7: 민감한 국기 흐림 처리

**Files:**
- Modify: `src/runtime/countryFlags.js`
- Modify: `src/Game/GameUI/other.jsx`
- Modify: `src/Game/GameUI/stats.jsx`
- Modify: `src/Game/Selection/Regions.jsx`

**Interfaces:**
- Produces: `isSensitiveFlag(gid0)` (from `countryFlags.js`) — Consumes: `getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags)` (Task 1)

**배경**: 국기 이미지가 렌더링되는 곳은 코드베이스 전체에서 4곳뿐(`other.jsx`, `stats.jsx`, `Selection/Regions.jsx`, 그리고 이모지만 쓰는 `chat.jsx` — 이모지는 블러 처리 대상에서 제외, 실사 이미지만 대상으로 함). "민감한" 기준이 될 공식 소스가 없으므로, 분쟁지역·승인이 갈리는 정치체로 흔히 언급되는 코드로 시작하는 최소 목록을 하드코딩한다 — 정확한 기준이 아니라 최초 구현이라는 점을 코드 주석에 남긴다.

- [ ] **Step 1: `countryFlags.js`에 판별 함수 추가**

파일 끝(`flagEmojiFromGid` 함수 다음)에 추가:

```js
// A starting list of commonly-disputed/contested polities, not an
// authoritative or exhaustive standard — there is no single agreed-upon
// source for this. Extend as needed; this is a first pass, not a policy.
const SENSITIVE_GID0_CODES = new Set(["TWN", "XKO", "PSE", "ESH"]);

export const isSensitiveFlag = (gid0) => SENSITIVE_GID0_CODES.has(String(gid0 ?? "").trim().toUpperCase());
```

- [ ] **Step 2: `other.jsx`에 블러 적용**

`other.jsx`에서 import 추가:

```js
import { flagEmojiFromGid, flagImageUrlFromGid, isSensitiveFlag } from "../../runtime/countryFlags.js";
import { MAP_SETTING_KEYS, getMapSetting } from "../../runtime/mapSettings.js";
```

`Other` 컴포넌트 본문에서 `const flagUrl = flagImageUrlFromGid(country);` 다음 줄에 추가:

```jsx
    const [blurSensitive, setBlurSensitive] = useState(
        () => getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags),
    );

    useEffect(() => {
        const onUpdated = () => setBlurSensitive(getMapSetting(MAP_SETTING_KEYS.blurSensitiveFlags));
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, []);

    const shouldBlur = blurSensitive && isSensitiveFlag(country);
```

그리고 `<img src={flagUrl} ... style={{ borderRadius: "50%", height: "100%", objectFit: "cover", width: "100%" }} />`의 style에 `filter: shouldBlur ? "blur(4px)" : "none"`을 추가:

```jsx
            style={{ borderRadius: "50%", height: "100%", objectFit: "cover", width: "100%", filter: shouldBlur ? "blur(4px)" : "none" }}
```

- [ ] **Step 3: `stats.jsx`에 동일 패턴 적용**

`stats.jsx`에서 `flagImageUrlFromGid` import 옆에 `isSensitiveFlag`를 추가로 가져오고, `MAP_SETTING_KEYS`/`getMapSetting`도 import한다. `const flagUrl = polity?.flag || flagImageUrlFromGid(targetCode);` 바로 다음에 `other.jsx`와 동일한 `blurSensitive`/`shouldBlur` 로직을 추가하고(컴포넌트 함수 본문 안), 해당 `<img src={flagUrl} .../>`의 style에 `filter: shouldBlur ? "blur(4px)" : "none"`을 추가한다. (정확한 컴포넌트 구조와 JSX 위치는 파일을 열어 `flagUrl` 사용처를 확인해 동일한 패턴으로 적용 — `other.jsx`에서 이미 검증된 것과 완전히 동일한 4줄짜리 패턴이므로 반복 적용이다.)

- [ ] **Step 4: `Selection/Regions.jsx`에 동일 패턴 적용**

`Regions.jsx`에서 `flagImageUrlFromGid`/`flagEmojiFromGid` import 옆에 `isSensitiveFlag` 추가, `MAP_SETTING_KEYS`/`getMapSetting` import 추가. `const imageUrl = flagImageUrlFromGid(gid0);` 부근에서 동일한 `blurSensitive`/`shouldBlur` 로직을 추가하고, `imageUrl`을 사용하는 `<img>`의 style에 동일하게 `filter`를 추가한다.

- [ ] **Step 5: 로컬 구동 후 확인**

설정에서 "Blur sensitive flags" 켜기 → 대만(TWN)을 플레이하거나 대만 지역을 선택해 국기가 흐리게 보이는지 확인(우하단 국기 배지, 국가 통계 패널, 지역 클릭 팝업 각각). 다른 일반 국가(예: 미국)는 흐려지지 않는지 확인. 토글을 끄면 모두 원래대로 보이는지 확인.

- [ ] **Step 6: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 7: 커밋**

```bash
git add src/runtime/countryFlags.js src/Game/GameUI/other.jsx src/Game/GameUI/stats.jsx src/Game/Selection/Regions.jsx
git commit -m "feat(ui): 민감한 국기 흐림 처리 옵션 추가 (분쟁지역 등 최소 목록 기반)"
```

---

## Task 8: PWA 설치 기능 — 아이콘 생성 + manifest + 서비스워커

**Files:**
- Create: `public/icon-192.png`, `public/icon-512.png` (ffmpeg로 생성)
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Modify: `index.html`
- Modify: `src/main.jsx`

**Interfaces:**
- 없음 (독립적인 마무리 태스크)

- [ ] **Step 1: 아이콘 생성**

```bash
ffmpeg -y -i public/logo.png -vf scale=192:192 public/icon-192.png
ffmpeg -y -i public/logo.png -vf scale=512:512 public/icon-512.png
```
두 명령 모두 `Output ... video:... audio:...` 형태의 성공 로그로 끝나야 하며, `public/icon-192.png`와 `public/icon-512.png` 파일이 생성되어야 한다(`ls -la public/icon-*.png`로 확인).

- [ ] **Step 2: `manifest.json` 작성**

```json
{
  "name": "Open Historia",
  "short_name": "Open Historia",
  "description": "An open source alternative to Pax Historia.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b1020",
  "theme_color": "#0b1020",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```
파일 위치: `public/manifest.json` (Vite가 `public/`을 그대로 루트에 복사하므로 빌드 후 `/manifest.json`으로 서빙된다 — 기존 `public/logo.png`가 `/logo.png`로 서빙되는 것과 동일한 규칙).

- [ ] **Step 3: `index.html`에 manifest 연결**

`index.html`의 `<meta name="theme-color" content="#0b1020" />` 다음 줄에 추가:

```html
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
```

- [ ] **Step 4: 최소 서비스워커 작성**

```js
/*! Open Historia — minimal service worker (PWA installability only, no caching) */
// This project's data (scenarios, games, world state) is fetched live from
// the server on every read — a caching service worker would risk serving
// stale game state. This one exists only to satisfy install criteria; it
// passes every request straight through to the network.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    event.respondWith(fetch(event.request));
});
```
파일 위치: `public/sw.js` (빌드 후 `/sw.js`로 서빙됨).

- [ ] **Step 5: 서비스워커 등록**

`src/main.jsx`의 맨 끝(`startTranslator();` 다음)에 추가:

```jsx
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}
```

- [ ] **Step 6: 로컬 구동 후 확인**

```bash
npm run build
node server/server.js
```
브라우저에서 **`http://localhost:3000`**(포트 3000 — 5173 Vite 개발 서버가 아니라 빌드된 프로덕션 서버로 확인해야 함, localhost는 HTTP라도 보안 컨텍스트로 취급됨)으로 접속 → 브라우저 개발자 도구 Application 탭에서 Manifest와 Service Worker가 정상 인식되는지 확인 → 주소창 오른쪽에 설치 아이콘이 뜨는지, 또는 브라우저 메뉴에 "설치" 항목이 있는지 확인 → 설치 후 별도 창(주소창 없는 앱 창)으로 열리는지 확인.

- [ ] **Step 7: 빌드/린트 확인**

```bash
npm run build
npm run lint
```

- [ ] **Step 8: 커밋**

```bash
git add public/icon-192.png public/icon-512.png public/manifest.json public/sw.js index.html src/main.jsx
git commit -m "feat(pwa): 앱을 설치 가능한 웹앱(PWA)으로 만듦 (manifest + 최소 서비스워커)"
```

---

## Self-Review 메모 (계획 작성자 기록)

- **Spec coverage**: 요구사항 5개 항목(PWA/토글4개/슬라이더3개→2개+제외1개/민감국기/UI섹션) 모두 태스크로 커버됨. "기능 크기(절대적)"와 "이벤트 애니메이션 비활성화"는 Global Constraints에서 근거를 명시하고 명시적으로 범위 제외 — TBD가 아니라 결정.
- **Placeholder 스캔**: 없음. 모든 스텝에 실제 코드 포함.
- **타입/시그니처 일관성**: `MAP_SETTING_KEYS`(Task 1에서 8개 키로 정의) → Task 2~7 전체에서 동일한 키 이름 재사용. `getMapSetting`/`setMapSetting`(Task 1) 시그니처가 이후 모든 태스크에서 동일하게 쓰임. `"mapSettings:updated"` 이벤트 이름이 Task 1(발신)과 Task 3/4/5/6/7(수신) 전체에서 일치. `isSensitiveFlag(gid0)`(Task 7에서 정의) 시그니처가 3개 소비 파일에서 동일하게 쓰임.
- **의존 순서**: Task 1(모듈) → Task 2(UI, 값 저장까지 완결) → Task 3~7(각자 독립적으로 Task 1을 소비, 서로 의존하지 않음, 순서 바꿔도 무방하나 문서 순서대로 진행 권장) → Task 8(완전히 독립적, PWA는 나머지와 무관).

## TLDR

Pax Historia 실제 설정 패널과 비교해 발견한 항목 중, 코드베이스에 명확히 대응 가능한 것만 골라 구현한다: mapSettings.js 런타임 모듈(Task 1) → 설정 UI(Task 2) → 국가 라벨 숨기기+기능 크기(Task 3) → 경계선 두께(Task 4) → 글로브 자동 공전 비활성화(Task 5) → 줌 감도/스크롤 반전/팬 관성(Task 6) → 민감한 국기 흐림(Task 7) → PWA 설치 기능(Task 8). "기능 크기(절대적)"와 "이벤트 애니메이션 비활성화", Pax Historia의 AI 티어 UX는 근거 부족 또는 사업모델 차이로 명시적으로 범위에서 제외했다.
