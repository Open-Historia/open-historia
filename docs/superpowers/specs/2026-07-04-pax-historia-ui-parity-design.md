# Pax Historia UI Parity — Phase 1 설계

##배경

사용자는 open-paxhistoria(Open-Historia 포크)를 실제 Pax Historia(paxhistoria.co)와 "동일한 UI"로 맞추길 원한다. 실제 서비스를 게스트 계정으로 직접 구동해 현재 open-historia HUD와 나란히 비교한 결과, 다음 구조적 차이를 확인했다:

- 상단 네비게이션 바 (Pax Historia는 게임 중에도 항상 표시, open-historia는 없음)
- 설정 아이콘 (⋮ vs ⚙️)
- 국가 표시 위치 (우하단 국기 아이콘 vs 좌상단 국가명 텍스트)
- 하단 액션바 아이콘 구성 (거의 유사)
- 국가 선택 화면 (포토 카드 그리드 vs 텍스트 목록)
- 프리셋/시나리오 허브 (히어로 캐러셀 + 통계 상세페이지 vs 현재 Netflix식 행)

범위가 너무 커서 한 번에 설계할 수 없어 사용자와 함께 우선순위 2가지로 좁혔다. 이 문서는 그 2가지(Phase 1)만 다룬다. 나머지(상단 네비게이션 바, 국가 선택 화면 교체)는 별도 설계 단계로 미룬다.

## Phase 1 — 범위

### 1. 설정 아이콘 · 국가 표시 위치 정리

**현재 상태**:
- `src/Game/GameUI/settings.jsx`의 `SettingsButton`이 "⚙️" 이모지를 표시.
- `src/Game/GameUI/other.jsx`의 `Other` 컴포넌트가 좌상단(설정 버튼 오른쪽, `left: 4.75rem`)에 국가명 텍스트 알약을 표시. `game.json`의 `country` 필드(정치체 코드, 예: "RUS")를 읽어 `useCountryDisplayName`으로 전체 이름을 구해 보여줌. 모바일에서는 숨겨지고 날짜 위젯에 통합됨(`isMobile` 체크).
- `src/runtime/countryFlags.js`에 이미 `flagEmojiFromGid(gid0)`(regional-indicator 이모지 생성)와 `flagImageUrlFromGid(gid0)`(flagcdn.com URL)가 존재 — 새 애셋 불필요.

**변경**:
- `settings.jsx`: `SettingsButton`의 "⚙️" → "⋮".
- `other.jsx`: 좌상단 텍스트 알약을 제거하고, 우하단에 국기 아이콘 전용 알약(작은 원형/사각 배지, `flagImageUrlFromGid` 이미지 우선, 로드 실패 시 `flagEmojiFromGid` 폴백)을 새로 추가. Toolbar(하단 액션바)와 겹치지 않도록 `bottom`/`right` 오프셋 조정.
- **커스텀 정치체 폴백**: `game.json`의 `country`가 실제 ISO 국가 코드가 아닌 시나리오 전용 코드(예: "HRE", "YUAN")인 경우 `flagImageUrlFromGid`/`flagEmojiFromGid`가 유효한 국기를 만들 수 없다. 이 경우 국가명 첫 글자로 된 단색 원형 배지로 폴백한다(맵의 `fallbackColorFromCode`와 동일한 발상, 새 로직 아님 — 이미 지도 렌더링에 쓰이는 패턴을 재사용).
- 모바일 분기(`isMobile`)는 기존 로직 유지 — 날짜 위젯에 통합된 표시 방식은 건드리지 않는다.

**수용 기준**:
- 데스크톱에서 게임 진입 시 좌상단에는 설정(⋮) 버튼만 보이고, 우하단에 플레이어 국가의 국기(또는 폴백 배지)가 보인다.
- 실제 국가(RUS, USA 등)와 커스텀 정치체(HRE 등) 양쪽에서 깨지지 않고 렌더링된다.
- 모바일 뷰(날짜 위젯 통합 표시)는 기존과 동일하게 동작한다.

### 2. 프리셋 허브 — 커버 이미지 + 상세보기

**현재 상태** (`src/Game/GameUI/communityHub.jsx`):
- GitHub 이슈를 스크래핑해 `parsePost()`가 title/author/avatar/설명/설치수/플레이수/좋아요/댓글수를 파싱. 이미지는 파싱하지 않는다.
- `ScenarioCard`가 텍스트 위주 카드(아바타만 작게 표시)로 4개 행(Pinned/Most Installed/Most Liked/Most Recent)에 배치된다.
- Import는 카드 안의 "Import" 버튼이 바로 실행(`handleImport`).

**변경**:
- `parsePost()`에 커버 이미지 추출 로직 추가: 이슈 본문에서 첫 번째 이미지(마크다운 `![...](url)` 또는 GitHub 첨부 `<img src="...">`, `github.com/user-attachments/assets/...` 패턴 — 이미 `BUNDLE_LINK_PATTERN`과 유사한 정규식 기법 재사용)를 찾아 `post.coverImageUrl`로 저장. 이미지가 없으면 `null`(카드는 현재처럼 텍스트만 표시하는 기존 동작으로 폴백 — 커버 이미지가 없다고 오류를 내지 않는다).
- `ScenarioCard`: `coverImageUrl`이 있으면 카드 상단에 16:9 썸네일을 추가(이미지 로드 실패 시 `onError`로 조용히 숨김 — 새 방식 아님, 기존 아바타 `<img>`도 브라우저 기본 깨진 이미지 아이콘을 보이는 정도라 이 참에 일관되게 처리).
- 카드를 클릭하면(Import/View 버튼이 아닌 카드 본문 클릭) 상세보기를 여는 상태(`selectedPost`)를 추가. 상세보기는 같은 패널 내부에서 카드 그리드를 대체하는 형태(모달 오버레이가 아니라 인플레이스 전환 — 기존 패널이 이미 스크롤 가능한 사이드 패널이라 모달을 새로 얹으면 z-index/레이아웃 충돌 위험이 커서, 기존 `CommunityPanel`의 콘텐츠 영역만 바꾸는 게 더 안전).
  - 상세보기 구성: 큰 커버 이미지(없으면 생략), 제목, 작성자, 통계 행(⬇ 설치 · 🚀 플레이 · 👍 좋아요 · 💬 댓글 — 기존 데이터 그대로, Pax Historia의 "라운드/복사" 같은 open-historia가 추적하지 않는 지표는 만들어내지 않는다), 설명 전문(카드에서는 200자로 잘리지만 상세보기에서는 전체 표시), 뒤로가기 버튼, 그리고 기존 Import 버튼을 더 크게 스타일링한 "Import & Play" 기본 액션 버튼.
- 히어로 캐러셀(Pinned 게시물 자동 회전 배너)은 **이번 범위에서 제외**한다 — 사용자가 "히어로 캐러셀까지는 빼줘"라고 명시적으로 답변함. 상세보기까지만 진행.

**수용 기준**:
- 커버 이미지가 있는 커뮤니티 게시물은 카드에 썸네일이 보인다.
- 이미지가 없는 게시물은 기존과 동일하게 텍스트만 있는 카드로 보인다(회귀 없음).
- 카드를 클릭하면 상세보기로 전환되고, 뒤로가기로 그리드로 복귀한다.
- 상세보기의 Import & Play 버튼은 기존 Import 로직과 동일하게 동작한다(새 임포트 경로를 만들지 않는다).

## Non-Goals (이번 Phase 1에서 하지 않음)

- 상단 네비게이션 바 추가 (다음 설계 단계)
- 국가 선택 화면을 포토 카드 그리드로 교체 (다음 설계 단계)
- 히어로 캐러셀
- Pax Historia의 코인/토큰 잔액, 로그인/아바타 시스템 등 수익화 관련 UI (오픈소스 개인 포크 특성상 범위 밖 — 별도 논의 없이는 만들지 않는다)
- "라운드 수", "복사 수" 등 open-historia가 현재 추적하지 않는 지표를 억지로 만들어내는 것

## 검증 방법

테스트 스위트가 없으므로 `npm run build`/`npm run lint` 통과 + 로컬 구동(`npm run dev` + `node server/server.js`) 후 수동 확인:
1. 실제 게임 진입 → 좌상단 ⋮, 우하단 국기 확인.
2. 커스텀 정치체 시나리오(예: medieval-1200/HRE) 진입 → 폴백 배지 확인.
3. 모바일 너비로 리사이즈 → 날짜 위젯 통합 표시 유지 확인.
4. 커뮤니티 탭 → 커버 이미지 있는/없는 게시물 각각 카드 렌더링 확인 → 카드 클릭 → 상세보기 → Import & Play 동작 확인 → 뒤로가기 확인.

## TLDR

Pax Historia와의 UI 격차 중 가장 우선순위가 높은 2가지 — (1) 설정 아이콘을 ⋮로, 국가 표시를 좌상단 텍스트에서 우하단 국기 아이콘으로 교체(커스텀 정치체 폴백 포함), (2) 커뮤니티 허브 카드에 커버 이미지를 추가하고 클릭 시 통계+큰 Import & Play 버튼이 있는 상세보기를 여는 기능 — 을 구현한다. 상단 네비게이션 바, 국가 선택 화면 교체, 히어로 캐러셀은 이번 범위에서 명시적으로 제외했다.
