# Firebase 연동 가이드

이 대시보드는 **Firebase(Firestore)** 로 선생님의 이름 수정과 학생 결과물을
모든 기기에서 실시간으로 공유합니다. 설정값을 채우기 전에는 자동으로
`localStorage`(이 기기에만 저장) 모드로 동작합니다.

---

## 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com 접속 → **프로젝트 추가**
2. 프로젝트 생성 후 좌측 **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치는 `asia-northeast3 (서울)` 권장
   - 우선 **테스트 모드**로 시작 (아래 보안 규칙 참고)

## 2. 웹 앱 등록 후 config 복사
1. 프로젝트 개요 ⚙️ → **프로젝트 설정 → 일반 → 내 앱 → 웹(</>)** 추가
2. 표시되는 `firebaseConfig` 값을 복사
3. [firebase-config.js](firebase-config.js) 의 값을 그대로 교체

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

값을 채우면 자동으로 `apiKey`가 `YOUR_`로 시작하지 않으므로 Firebase 모드가 켜집니다.
화면 우상단 배지가 **☁️ 실시간 동기화** 로 바뀌면 연결 성공입니다.

## 3. 로컬 서버로 실행 (필수)
> ⚠️ `type="module"` 과 Firebase는 `file://` 로 직접 열면 CORS 로 막힙니다.
> 반드시 로컬 서버로 띄워야 합니다.

```bash
# 폴더에서 아래 중 하나
npx serve .
# 또는
python -m http.server 5500
```
그 후 브라우저에서 `http://localhost:3000` (serve) 또는 `http://localhost:5500` 접속.
VS Code 라면 **Live Server** 확장도 가능합니다.

## 4. Google 로그인 켜기 (Authentication)
1. 콘솔 좌측 **빌드 → Authentication → 시작하기**
2. **Sign-in method** 탭 → **Google** 선택 → **사용 설정** → 지원 이메일 지정 후 저장
3. **Settings → 승인된 도메인(Authorized domains)** 에 앱을 띄우는 도메인을 추가
   - `localhost` 는 기본 포함되어 있어 로컬 개발은 바로 됩니다
   - 배포 시 사용하는 도메인(예: `your-app.web.app`)을 추가하세요

로그인하면 화면 우상단에 프로필 사진·이름이 표시되고, 결과물에 **작성자 이름**이 함께 기록됩니다.
Firebase 모드에서는 **로그인해야** 이름 수정·결과물 등록/삭제가 가능합니다. (읽기는 자유)

## 5. Firestore 보안 규칙
콘솔의 **Firestore → 규칙** 에서 설정하세요.

**권장 (로그인한 사람만 쓰기 가능, 읽기는 자유):**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
> 이 규칙에서는 학생 명단(`classes`) 시드도 로그인 후에 생성됩니다.
> 앱이 로그인 시점에 자동으로 시드를 보장하므로, 처음엔 **선생님이 한 번 로그인**하면 명단이 채워집니다.

**테스트용 (누구나 읽기/쓰기 — 로그인 없이도 시드 생성):**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

더 엄격히 하려면 `walls/{studentId}/posts` 작성 시 `request.resource.data.authorUid == request.auth.uid`
조건을 추가해 본인 작성만 허용할 수 있습니다. 원하시면 학생/교사 역할 분리까지 확장해 드립니다.

---

## 데이터 구조
- `classes/{5,6,7,8}` → `{ students: [ {id, number, name, status} ] }` (이름 수정 대상)
- `walls/{studentId}/posts/{postId}` → `{ title, body, link, color, date, authorName, authorUid, createdAt }` (담벼락 결과물)

`studentId` 는 `반-번호` 형식(예: `5-12`)으로 새로고침에도 변하지 않습니다.

## 데이터 초기화
처음 실행 시 4개 반 학생이 자동 생성(시드)됩니다. 다시 만들고 싶으면
Firestore 콘솔에서 `classes` 문서를 삭제하고 새로고침하세요.
(로컬 모드라면 콘솔에서 `localStorage.clear()` 후 새로고침)
