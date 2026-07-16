// Theme Toggle
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;
const THEME_KEY = 'airylio-theme';

// Initialize theme from localStorage or system preference
function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);

  if (savedTheme) {
    setTheme(savedTheme);
  } else {
    // Check system preference
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

// Close menu when clicking on a link
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

    // Close all other items
    document.querySelectorAll('.accordion-item').forEach(item => {
      item.classList.remove('active');
    });

    // Toggle current item
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

// Observe all sections and cards
document.querySelectorAll(
  '.hero-content, .feature-card, .how-step, .preview-phone, .confidence-card, .accordion-item'
).forEach(el => {
  observer.observe(el);
});

// Initialize
initializeTheme();
