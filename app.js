import { firebaseConfig, firebaseEnabled } from './firebase-config.js';

// Firebase 모듈 SDK 버전 (CDN)
const FB_VERSION = "10.12.0";
const CLASS_IDS = ["5", "6", "7", "8"];

// ===== 영속화 키 (로컬 폴백용) =====
const LS_CLASSES = "damdam_classes_v1";
const LS_WALLS = "damdam_walls_v1";

// ===== 학생 데이터 생성 (시드) =====
function generateStudents(classNum) {
  const students = [];
  const statusOptions = ["출석", "결석", "지각", "조퇴"];
  const surnameOptions = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
  const nameOptions = ["민준", "서연", "도윤", "서윤", "시우", "지우", "민재", "하은", "지훈", "현우", "지민", "은지", "수현", "승현", "유진", "은우", "하준", "수아", "다은"];

  for (let i = 1; i <= 35; i++) {
    const randomSurname = surnameOptions[Math.floor(Math.random() * surnameOptions.length)];
    const randomName = nameOptions[Math.floor(Math.random() * nameOptions.length)];
    const isPresent = Math.random() > 0.1;
    const status = isPresent ? "출석" : statusOptions[Math.floor(Math.random() * (statusOptions.length - 1)) + 1];
    students.push({ id: `${classNum}-${i}`, number: i, name: randomSurname + randomName, status });
  }
  return students;
}

// ============================================================
//  데이터 계층 (Firebase / localStorage 공통 인터페이스)
//    seedIfNeeded()
//    onClasses(cb) -> unsubscribe         // cb(classDataObject)
//    renameStudent(classNum, studentId, name)
//    onWall(studentId, cb) -> unsubscribe // cb(postsArray)
//    addPost(studentId, post)
//    deletePost(studentId, postId)
// ============================================================

// ----- 로컬(localStorage) 구현 -----
function makeLocalStore() {
  function loadClasses() {
    const saved = localStorage.getItem(LS_CLASSES);
    if (saved) { try { return JSON.parse(saved); } catch (e) {} }
    const data = {};
    CLASS_IDS.forEach(cn => data[cn] = generateStudents(cn));
    localStorage.setItem(LS_CLASSES, JSON.stringify(data));
    return data;
  }
  const saveClasses = (d) => localStorage.setItem(LS_CLASSES, JSON.stringify(d));
  const loadWalls = () => { try { return JSON.parse(localStorage.getItem(LS_WALLS)) || {}; } catch (e) { return {}; } };
  const saveWalls = (d) => localStorage.setItem(LS_WALLS, JSON.stringify(d));

  let classes = loadClasses();
  let classesCb = null;
  let wallCb = null, wallSid = null;

  return {
    mode: 'local',
    auth: null, // 로컬 모드는 로그인 없음
    async seedIfNeeded() {},
    onClasses(cb) { classesCb = cb; cb(classes); return () => { classesCb = null; }; },
    async renameStudent(classNum, studentId, name) {
      const s = (classes[classNum] || []).find(x => x.id === studentId);
      if (s) { s.name = name; saveClasses(classes); }
      if (classesCb) classesCb(classes);
    },
    onWall(studentId, cb) {
      wallSid = studentId; wallCb = cb;
      cb(loadWalls()[studentId] || []);
      return () => { wallCb = null; wallSid = null; };
    },
    async addPost(studentId, post) {
      const w = loadWalls();
      (w[studentId] = w[studentId] || []).unshift(post);
      saveWalls(w);
      if (wallCb && wallSid === studentId) wallCb(w[studentId]);
    },
    async deletePost(studentId, postId) {
      const w = loadWalls();
      w[studentId] = (w[studentId] || []).filter(p => p.id !== postId);
      saveWalls(w);
      if (wallCb && wallSid === studentId) wallCb(w[studentId]);
    }
  };
}

// ----- Firebase(Firestore) 구현 -----
async function makeFirebaseStore() {
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
  const authMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`);
  const {
    getFirestore, collection, doc, getDoc, setDoc, updateDoc,
    onSnapshot, addDoc, deleteDoc, query, orderBy, serverTimestamp
  } = fs;
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = authMod;

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  return {
    mode: 'firebase',
    auth: {
      onChange: (cb) => onAuthStateChanged(auth, cb),
      signIn: () => signInWithPopup(auth, provider),
      signOut: () => signOut(auth),
      current: () => auth.currentUser
    },
    async seedIfNeeded() {
      for (const cn of CLASS_IDS) {
        const ref = doc(db, 'classes', cn);
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, { students: generateStudents(cn) });
      }
    },
    onClasses(cb) {
      const classes = {};
      const unsubs = CLASS_IDS.map(cn =>
        onSnapshot(doc(db, 'classes', cn), snap => {
          classes[cn] = snap.exists() ? (snap.data().students || []) : [];
          cb({ ...classes });
        })
      );
      return () => unsubs.forEach(u => u());
    },
    async renameStudent(classNum, studentId, name) {
      const ref = doc(db, 'classes', classNum);
      const snap = await getDoc(ref);
      const students = (snap.data().students || []).map(s => s.id === studentId ? { ...s, name } : s);
      await updateDoc(ref, { students });
    },
    onWall(studentId, cb) {
      const q = query(collection(db, 'walls', studentId, 'posts'), orderBy('createdAt', 'desc'));
      return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    },
    async addPost(studentId, post) {
      await addDoc(collection(db, 'walls', studentId, 'posts'), {
        title: post.title, body: post.body, link: post.link,
        color: post.color, date: post.date,
        authorName: post.authorName || null, authorUid: post.authorUid || null,
        createdAt: serverTimestamp()
      });
    },
    async deletePost(studentId, postId) {
      await deleteDoc(doc(db, 'walls', studentId, 'posts', postId));
    }
  };
}

// ===== 상태 =====
let store = null;
let classData = {};
let teacherMode = false;
let currentClass = "5";
let activeStudent = null;
let wallUnsub = null;
let selectedColor = 'pink';
let currentUser = null;

// ===== DOM =====
const tabs = document.querySelectorAll('.category-tab');
const studentsGrid = document.getElementById('studentsGrid');
const modeToggle = document.getElementById('modeToggle');
const modeHint = document.getElementById('modeHint');
const syncStatus = document.getElementById('syncStatus');

const loginBtn = document.getElementById('loginBtn');
const userChip = document.getElementById('userChip');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');

const wallOverlay = document.getElementById('wallOverlay');
const wallBoard = document.getElementById('wallBoard');
const wallTitle = document.getElementById('wallTitle');
const wallBack = document.getElementById('wallBack');
const addPostBtn = document.getElementById('addPostBtn');

const postModal = document.getElementById('postModal');
const postForm = document.getElementById('postForm');
const postTitle = document.getElementById('postTitle');
const postBody = document.getElementById('postBody');
const postLink = document.getElementById('postLink');
const postCancel = document.getElementById('postCancel');
const colorRow = document.getElementById('colorRow');

const cycleColors = [
  "feature-card-pink", "feature-card-teal", "feature-card-lavender",
  "feature-card-peach", "feature-card-ochre", "feature-card-cream"
];

// ===== 대시보드 렌더링 =====
function renderStudents(classNum) {
  currentClass = classNum;
  const students = classData[classNum] || [];
  studentsGrid.innerHTML = '';

  if (students.length === 0) {
    studentsGrid.innerHTML = `<p class="body-sm" style="grid-column:1/-1;text-align:center;">불러오는 중…</p>`;
    return;
  }

  students.forEach((student, index) => {
    const cardColor = cycleColors[index % cycleColors.length];
    const card = document.createElement('div');
    card.className = `feature-card ${cardColor}`;
    const note = student.status === '출석' ? '특이사항 없음' : '사유 확인 필요';

    card.innerHTML = `
      <div class="student-header">
        <span class="student-number">${String(student.number).padStart(2, '0')}</span>
        <span class="badge-pill">${student.status}</span>
      </div>
      <h3 class="title-md student-name" role="button" tabindex="0">${escapeHtml(student.name)}</h3>
      <p class="body-sm" style="color: inherit; opacity: 0.85; margin-top: 8px;">${note}</p>
      <button class="edit-name-btn" title="이름 수정" aria-label="이름 수정">✏️</button>
    `;

    const nameEl = card.querySelector('.student-name');
    nameEl.addEventListener('click', () => { if (!teacherMode) openWall(student); });
    nameEl.addEventListener('keydown', (e) => {
      if (!teacherMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openWall(student); }
    });

    card.querySelector('.edit-name-btn')
      .addEventListener('click', () => startRename(card, student, classNum));

    studentsGrid.appendChild(card);
  });
}

// ===== 이름 수정 (인라인) =====
function startRename(card, student, classNum) {
  const nameEl = card.querySelector('.student-name');
  if (card.querySelector('.rename-row')) return;

  const row = document.createElement('div');
  row.className = 'rename-row';
  row.innerHTML = `
    <input type="text" class="rename-input" value="${escapeAttr(student.name)}" maxlength="20">
    <button class="rename-save" type="button">저장</button>
    <button class="rename-cancel" type="button">취소</button>
  `;
  nameEl.replaceWith(row);
  const input = row.querySelector('.rename-input');
  input.focus(); input.select();

  const finish = async (save) => {
    if (save) {
      const newName = input.value.trim();
      if (newName && newName !== student.name) {
        if (!ensureAuthed()) { renderStudents(currentClass); return; }
        await store.renameStudent(classNum, student.id, newName);
        return; // onClasses 스냅샷이 다시 그려줌
      }
    }
    renderStudents(currentClass);
  };

  row.querySelector('.rename-save').addEventListener('click', () => finish(true));
  row.querySelector('.rename-cancel').addEventListener('click', () => finish(false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
}

// ===== 선생님 모드 =====
function setTeacherMode(on) {
  teacherMode = on;
  document.body.classList.toggle('teacher-mode', on);
  modeToggle.textContent = on ? '학생 모드' : '선생님 모드';
  modeToggle.classList.toggle('is-active', on);
  modeHint.textContent = on
    ? '선생님 모드 · ✏️ 를 눌러 학생 이름을 수정하세요'
    : '학생 모드 · 이름을 누르면 담벼락이 열려요';
}
modeToggle.addEventListener('click', () => setTeacherMode(!teacherMode));

// ===== 탭 =====
tabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    tabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    renderStudents(e.target.getAttribute('data-class'));
  });
});

// ===== 담벼락 =====
function openWall(student) {
  activeStudent = student;
  wallTitle.textContent = `${student.name}의 담벼락`;
  wallBoard.innerHTML = `<p class="body-sm" style="column-span:all;text-align:center;">불러오는 중…</p>`;
  wallOverlay.hidden = false;
  document.body.classList.add('no-scroll');
  wallUnsub = store.onWall(student.id, posts => renderWall(posts));
}

function closeWall() {
  if (wallUnsub) { wallUnsub(); wallUnsub = null; }
  wallOverlay.hidden = true;
  activeStudent = null;
  document.body.classList.remove('no-scroll');
}

function renderWall(posts) {
  wallBoard.innerHTML = '';
  if (!posts || posts.length === 0) {
    wallBoard.innerHTML = `
      <div class="wall-empty">
        <p class="title-md">아직 붙인 결과물이 없어요</p>
        <p class="body-sm">오른쪽 위 <strong>+ 결과물 추가</strong> 버튼으로 첫 결과물을 올려보세요!</p>
      </div>`;
    return;
  }

  posts.forEach(post => {
    const note = document.createElement('article');
    note.className = `wall-note color-${post.color || 'cream'}`;
    const link = post.link
      ? (isImage(post.link)
          ? `<img class="wall-note-img" src="${escapeAttr(post.link)}" alt="">`
          : `<a class="wall-note-link" href="${escapeAttr(post.link)}" target="_blank" rel="noopener">🔗 링크 열기</a>`)
      : '';
    const meta = post.authorName
      ? `<span class="wall-note-author">✍️ ${escapeHtml(post.authorName)}</span> · ${escapeHtml(post.date || '')}`
      : escapeHtml(post.date || '');
    note.innerHTML = `
      <button class="wall-note-del" title="삭제" aria-label="삭제">×</button>
      <h4 class="wall-note-title">${escapeHtml(post.title)}</h4>
      ${post.body ? `<p class="wall-note-body">${escapeHtml(post.body)}</p>` : ''}
      ${link}
      <span class="wall-note-date">${meta}</span>
    `;
    note.querySelector('.wall-note-del').addEventListener('click', () => deletePost(post.id));
    wallBoard.appendChild(note);
  });
}

async function deletePost(postId) {
  if (!ensureAuthed()) return;
  if (!confirm('이 결과물을 삭제할까요?')) return;
  await store.deletePost(activeStudent.id, postId);
}

// ----- 결과물 추가 모달 -----
function openPostModal() {
  if (!ensureAuthed()) return;
  postForm.reset();
  selectColor('pink');
  postModal.hidden = false;
  postTitle.focus();
}
function closePostModal() { postModal.hidden = true; }

function selectColor(color) {
  selectedColor = color;
  colorRow.querySelectorAll('.color-dot').forEach(dot =>
    dot.classList.toggle('selected', dot.dataset.color === color));
}
colorRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (dot) selectColor(dot.dataset.color);
});

postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ensureAuthed()) return;
  const user = store.auth ? store.auth.current() : null;
  const post = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, // 로컬용 id
    title: postTitle.value.trim(),
    body: postBody.value.trim(),
    link: postLink.value.trim(),
    color: selectedColor,
    date: formatDate(new Date()),
    authorName: user ? (user.displayName || '익명') : null,
    authorUid: user ? user.uid : null
  };
  closePostModal();
  await store.addPost(activeStudent.id, post);
});

// ===== 이벤트 바인딩 =====
wallBack.addEventListener('click', closeWall);
addPostBtn.addEventListener('click', openPostModal);
postCancel.addEventListener('click', closePostModal);
postModal.addEventListener('click', (e) => { if (e.target === postModal) closePostModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!postModal.hidden) closePostModal();
  else if (!wallOverlay.hidden) closeWall();
});

// ===== 유틸 =====
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;
const isImage = (url) => /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(url);
function formatDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function setSyncBadge(mode) {
  if (mode === 'firebase') {
    syncStatus.textContent = '☁️ 실시간 동기화';
    syncStatus.classList.add('online');
  } else {
    syncStatus.textContent = '💾 이 기기에만 저장';
    syncStatus.classList.add('offline');
  }
}

// 쓰기 작업 전 로그인 확인 (Firebase 모드에서만 요구)
function ensureAuthed() {
  if (store && store.auth && !store.auth.current()) {
    alert('Google 로그인 후 이용할 수 있어요.');
    return false;
  }
  return true;
}

// ===== 로그인 UI =====
function setupAuthUI() {
  if (!store.auth) {
    // 로컬 모드: 로그인 관련 UI 숨김
    loginBtn.hidden = true;
    userChip.hidden = true;
    return;
  }

  loginBtn.addEventListener('click', () => {
    store.auth.signIn().catch(err => {
      console.warn('[Auth] 로그인 실패', err);
      alert('로그인에 실패했어요: ' + (err.message || err.code || err));
    });
  });
  logoutBtn.addEventListener('click', () => store.auth.signOut());

  store.auth.onChange(user => {
    currentUser = user;
    if (user) {
      loginBtn.hidden = true;
      userChip.hidden = false;
      userName.textContent = user.displayName || '사용자';
      if (user.photoURL) { userAvatar.src = user.photoURL; userAvatar.hidden = false; }
      else { userAvatar.hidden = true; }
      // 보호 규칙(쓰기에 인증 필요)인 경우, 로그인 후 시드 보장
      store.seedIfNeeded().catch(() => {});
    } else {
      loginBtn.hidden = false;
      userChip.hidden = true;
    }
  });
}

// ===== 부팅 =====
async function boot() {
  if (firebaseEnabled) {
    try {
      store = await makeFirebaseStore();
      await store.seedIfNeeded().catch(() => {}); // 보호 규칙이면 로그인 후 재시도
    } catch (err) {
      console.warn('[Firebase] 초기화 실패 → 로컬 저장으로 전환합니다.', err);
      store = makeLocalStore();
    }
  } else {
    store = makeLocalStore();
  }

  setSyncBadge(store.mode);
  setupAuthUI();
  store.onClasses(data => {
    classData = data;
    renderStudents(currentClass);
  });
}

boot();
