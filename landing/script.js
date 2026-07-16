// Theme Toggle
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;
const THEME_KEY = 'airylio-theme';

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);

  if (savedTheme) {
    setTheme(savedTheme);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
  }
}

function setTheme(theme) {
  if (theme === 'dark') {
    html.classList.add('dark');
    themeToggle.textContent = '☀️';
  } else {
    html.classList.remove('dark');
    themeToggle.textContent = '🌙';
  }
  localStorage.setItem(THEME_KEY, theme);
}

themeToggle.addEventListener('click', () => {
  const isDark = html.classList.contains('dark');
  setTheme(isDark ? 'light' : 'dark');
});

// Mobile Menu Toggle
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navMenu = document.getElementById('navMenu');

mobileMenuBtn.addEventListener('click', () => {
  navMenu.classList.toggle('active');
});

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navMenu.classList.remove('active');
  });
});

// FAQ Accordion
const accordionHeaders = document.querySelectorAll('.accordion-header');

accordionHeaders.forEach(header => {
  header.addEventListener('click', () => {
    const accordionItem = header.parentElement;
    const isActive = accordionItem.classList.contains('active');

    document.querySelectorAll('.accordion-item').forEach(item => {
      item.classList.remove('active');
    });

    if (!isActive) {
      accordionItem.classList.add('active');
    }
  });
});

// Smooth Scroll for Navigation Links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Scroll-triggered Fade-in Animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('reveal');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll(
  '.hero-content, .feature-card, .demo-container, .feature-hero-card, .why-airylio'
).forEach(el => {
  observer.observe(el);
});

// Demo Calculator
function calculateDemo() {
  const from = document.getElementById('demo-from').value;
  const to = document.getElementById('demo-to').value;
  const arriveByInput = document.getElementById('demo-arrive').value;
  const transport = document.getElementById('demo-transport').value;
  const resultDiv = document.getElementById('demo-result');

  // Parse arrive by time
  const [arriveHour, arriveMin] = arriveByInput.split(':').map(Number);

  // Simulate travel time based on transport mode
  const travelTimes = {
    drive: 45,
    motorcycle: 35,
    commute: 55,
    walk: 120
  };

  const baseTravel = travelTimes[transport] || 45;
  const travelTime = baseTravel + Math.floor(Math.random() * 20 - 10);

  // Add buffer (5-15 min)
  const buffer = 5 + Math.floor(Math.random() * 10);
  const totalTime = travelTime + buffer;

  // Calculate leave time
  const leaveMinutes = arriveHour * 60 + arriveMin - totalTime;
  const leaveHour = Math.floor(leaveMinutes / 60);
  const leaveMin = leaveMinutes % 60;

  const leaveHourDisplay = leaveHour < 10 ? `0${leaveHour}` : leaveHour;
  const leaveMinDisplay = leaveMin < 10 ? `0${leaveMin}` : leaveMin;

  // Generate confidence score (85-95%)
  const confidence = 85 + Math.floor(Math.random() * 11);

  // Show loading state
  resultDiv.classList.remove('demo-result-hidden');
  const resultContent = resultDiv.querySelector('.demo-result-content');
  resultContent.style.opacity = '0.5';

  setTimeout(() => {
    // Update result values
    document.getElementById('demo-leave-time').textContent = `${leaveHourDisplay}:${leaveMinDisplay} AM`;
    document.getElementById('demo-confidence-pct').textContent = `${confidence}%`;
    document.getElementById('demo-arrive-time').textContent = arriveByInput.replace(':', ':');

    // Animate confidence ring
    const ringAnimate = resultDiv.querySelector('.demo-ring-animate');
    ringAnimate.style.strokeDasharray = `${(confidence / 100) * 201} 201`;

    resultContent.style.opacity = '1';
  }, 500);
}

// Initialize
initializeTheme();
