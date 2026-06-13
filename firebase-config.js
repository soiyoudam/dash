// ============================================================
//  Firebase 설정
//  Firebase 콘솔(console.firebase.google.com)에서 프로젝트를
//  만든 뒤, "웹 앱 추가"에서 받은 config 값을 아래에 붙여넣으세요.
//  값을 채우기 전에는 자동으로 localStorage 모드로 동작합니다.
// ============================================================

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// apiKey가 아직 기본 플레이스홀더이면 Firebase 비활성화로 간주
export const firebaseEnabled = !firebaseConfig.apiKey.startsWith("YOUR_");
