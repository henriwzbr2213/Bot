const USER_KEY = 'discloud-user';
const SESSION_KEY = 'discloud-session';

const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const authTitle = document.getElementById('auth-title');
const switchCopy = document.getElementById('switch-copy');
const switchModeBtn = document.getElementById('switch-mode');
const submitBtn = document.getElementById('submit-btn');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorNode = document.getElementById('error');
const cardsGrid = document.getElementById('cards-grid');
const welcome = document.getElementById('welcome');

let isLogin = true;

const cards = [
  { title: 'Build', desc: 'Gerencie uploads e builds do Cloud Build com um clique.' },
  { title: 'Resource summary', desc: 'Monitore apps, uso por região e planos em tempo real.' },
  { title: 'Planned maintenance', desc: 'Acompanhe eventos e manutenção de clusters BR/US.' },
  { title: 'Cloud status', desc: 'Visualize status operacional e alertas da plataforma.' }
];

cards.forEach((card) => {
  const article = document.createElement('article');
  article.className = 'dash-card';
  article.innerHTML = `<h3>${card.title}</h3><p>${card.desc}</p><span>Getting started</span>`;
  cardsGrid.appendChild(article);
});

function setError(text = '') {
  if (!text) {
    errorNode.textContent = '';
    errorNode.classList.add('hidden');
    return;
  }
  errorNode.textContent = text;
  errorNode.classList.remove('hidden');
}

function renderAuthMode() {
  authTitle.textContent = isLogin ? 'Log into your account' : 'Create your account';
  submitBtn.textContent = isLogin ? 'Login with email' : 'Create account';
  switchCopy.textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
  switchModeBtn.textContent = isLogin ? 'Sign up' : 'Login';
  nameInput.classList.toggle('hidden', isLogin);
  nameInput.required = !isLogin;
  setError('');
}

function showDashboard(user) {
  welcome.textContent = `Bem-vindo, ${user.name}`;
  authScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
}

switchModeBtn.addEventListener('click', () => {
  isLogin = !isLogin;
  renderAuthMode();
});

document.getElementById('auth-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (isLogin) {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (!user) return setError('Nenhum cadastro encontrado. Clique em Sign up.');
    if (user.email !== email || user.password !== password) return setError('Credenciais inválidas.');
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    showDashboard(user);
    return;
  }

  const payload = { name: nameInput.value.trim() || 'Usuário', email, password };
  localStorage.setItem(USER_KEY, JSON.stringify(payload));
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  showDashboard(payload);
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  dashboardScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
if (session) {
  showDashboard(session);
} else {
  renderAuthMode();
}
