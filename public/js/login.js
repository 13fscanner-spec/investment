document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  
  errorEl.classList.remove('active');
  btn.textContent = 'Verificando...';
  btn.disabled = true;
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (res.ok) {
      window.location.href = '/';
    } else {
      throw new Error();
    }
  } catch (err) {
    errorEl.classList.add('active');
    btn.textContent = 'Ingresar al Portafolio';
    btn.disabled = false;
  }
});
