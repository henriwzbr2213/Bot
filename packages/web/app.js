const SESSION_KEY = 'discloud-session';
const API_BASE_URL = window.DISCOULD_API_BASE_URL || 'http://localhost:3000';
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/;

const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const authTitle = document.getElementById('auth-title');
const switchCopy = document.getElementById('switch-copy');
const switchModeBtn = document.getElementById('switch-mode');
const submitBtn = document.getElementById('submit-btn');
const nameInput = document.getElementById('name');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const passwordHint = document.getElementById('password-hint');
const errorNode = document.getElementById('error');
const successNode = document.getElementById('success');
const cardsGrid = document.getElementById('cards-grid');
const welcome = document.getElementById('welcome');

let isLogin = true;
let isSubmitting = false;

const cards = [
  { title: 'Build', desc: 'Explore IBM Cloud with this selection of easy starter tutorials and services.' },
  { title: 'Save the date', desc: 'Hear how enterprises are driving transformation without compromise.' },
  { title: 'Monitor your resources', desc: 'Get visibility into the performance and health of your resources.' },
  { title: 'Infrastructure as Code', desc: 'Different approaches to use and how each impacts your environment.' },
  { title: 'Build and deploy apps', desc: 'Go from zero to production in minutes with your applications.' },
  { title: 'Starter kits', desc: 'Generate cloud-native apps and get started quickly.' }
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

function setSuccess(text = '') {
  if (!text) {
    successNode.textContent = '';
    successNode.classList.add('hidden');
    return;
  }
  successNode.textContent = text;
  successNode.classList.remove('hidden');
}

function setRoute(route) {
  window.location.hash = route;
}

function setLoading(loading) {
  isSubmitting = loading;
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Processing...' : isLogin ? 'Login with email' : 'Create account';
}

function renderAuthMode() {
  authTitle.textContent = isLogin ? 'Log into your account' : 'Create your account';
  submitBtn.textContent = isLogin ? 'Login with email' : 'Create account';
  switchCopy.textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
  switchModeBtn.textContent = isLogin ? 'Sign up' : 'Login';

  nameInput.classList.toggle('hidden', isLogin);
  confirmPasswordInput.classList.toggle('hidden', isLogin);
  passwordHint.classList.toggle('hidden', isLogin);
  nameInput.required = !isLogin;
  confirmPasswordInput.required = !isLogin;

  setError('');
  setSuccess('');
  setLoading(false);
}

function showDashboard(user) {
  welcome.textContent = `Bem-vindo, ${user.name}`;
  authScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  setRoute('dashboard');
}

function showAuth() {
  dashboardScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  setRoute('auth');
}

async function parseApiResponse(response) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || 'Erro desconhecido' };
  }

  if (!response.ok) {
    throw new Error(data?.message || 'Falha na requisição');
  }

  return data;
}

switchModeBtn.addEventListener('click', () => {
  if (isSubmitting) return;
  isLogin = !isLogin;
  renderAuthMode();
});

passwordInput.addEventListener('input', () => {
  if (isLogin) return;
  if (STRONG_PASSWORD.test(passwordInput.value)) {
    setSuccess('Senha forte detectada.');
    setError('');
  } else {
    setSuccess('');
  }
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) {
    setError('Preencha email e senha.');
    return;
  }

  setLoading(true);

  try {
    if (isLogin) {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await parseApiResponse(response);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Falha no login.');

      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setSuccess('Login realizado com sucesso!');
      setError('');
      showDashboard(data);
      return;
    }

    const name = nameInput.value.trim() || 'Usuário';
    const confirm = confirmPasswordInput.value;

    if (!STRONG_PASSWORD.test(password)) {
      throw new Error('Use senha forte: mínimo 10 chars com maiúscula, minúscula, número e símbolo.');
    }

    if (password !== confirm) {
      throw new Error('As senhas não conferem.');
      setError('Use senha forte: mínimo 10 chars com maiúscula, minúscula, número e símbolo.');
      return;
    }

    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await parseApiResponse(response);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || 'Falha no cadastro.');

    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    setSuccess('Cadastro realizado com sucesso! Redirecionando para dashboard...');
    setError('');
    showDashboard(data);
  } catch (error) {
    setSuccess('');
    const message = error instanceof Error ? error.message : 'Erro inesperado';
    setError(message.includes('Email já cadastrado') ? 'Já existe uma conta com este email.' : message);
  } finally {
    setLoading(false);
    setError(error instanceof Error ? error.message : 'Erro inesperado');
  }
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem(SESSION_KEY);
  showAuth();
  renderAuthMode();
});

function bootstrap() {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (session) {
    showDashboard(session);
    return;
  }
  showAuth();
  renderAuthMode();
}

bootstrap();
