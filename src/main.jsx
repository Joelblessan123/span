console.log('main.jsx: Script loaded')

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Footer from './components/Footer'
import Navbar from './components/Navbar'
import './index.css'

const mountApp = (element, page) => {
  if (!element) {
    console.log(`mountApp: Element not found for page "${page}"`)
    return
  }
  console.log(`mountApp: Mounting page "${page}" to element`, element)
  ReactDOM.createRoot(element).render(
    <React.StrictMode>
      <App page={page} />
    </React.StrictMode>
  )
}

const mountFooter = (element) => {
  if (!element) return

  ReactDOM.createRoot(element).render(
    <React.StrictMode>
      <Footer />
    </React.StrictMode>
  )
}

const mountNavbar = (element) => {
  if (!element) return

  ReactDOM.createRoot(element).render(
    <React.StrictMode>
      <Navbar />
    </React.StrictMode>
  )
}

/** Only load heavy homepage widgets when their mount nodes exist. */
const mountLazyComponent = async (element, importer) => {
  if (!element) return
  const { default: Component } = await importer()
  ReactDOM.createRoot(element).render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>
  )
}

function mountComponents() {
  console.log('mountComponents: Starting to mount components')

  mountApp(document.getElementById('home-root'), 'home')
  mountApp(document.getElementById('bills-root'), 'bills')
  mountApp(document.getElementById('blog-root'), 'blog')
  mountApp(document.getElementById('blog-post-root'), 'blog-post')
  mountApp(document.getElementById('directory-root'), 'directory')
  mountApp(document.getElementById('our-story-root'), 'our-story')
  mountApp(document.getElementById('login-root'), 'login')
  mountApp(document.getElementById('dashboard-root'), 'dashboard')
  mountApp(document.getElementById('classroom-join-root'), 'classroom-join')
  mountApp(document.getElementById('mentor-join-root'), 'mentor-join')
  mountApp(document.getElementById('classroom-dashboard-root'), 'classroom-dashboard')
  mountApp(document.getElementById('bills-preview-root'), 'bills-preview')
  mountApp(document.getElementById('bills-stats-root'), 'bills-stats')

  mountNavbar(document.getElementById('navbarContainer'))
  mountFooter(document.getElementById('footerContainer'))

  mountLazyComponent(document.getElementById('schools-carousel-root'), () => import('./components/SchoolsCarousel'))
  mountLazyComponent(document.getElementById('team-section-root'), () => import('./components/TeamSection'))
  mountLazyComponent(document.getElementById('impact-map-root'), () => import('./components/ImpactMap'))
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountComponents)
} else {
  setTimeout(mountComponents, 0)
}
