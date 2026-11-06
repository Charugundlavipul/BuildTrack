import { Link } from 'react-router-dom'
import { Brand } from '../../components/Brand'
import './SignInVisual.css'

export function SignInVisual() {
  return <section className="auth-story signin-visual" aria-labelledby="brand-heading">
    <img className="signin-visual-image" src="/images/inspection-ready-home-v2.webp" alt="Home inspector with a tablet checking a completed home before handover" fetchPriority="high" />
    <Link to="/" aria-label="BuildTrack home"><Brand /></Link>
    <h2 id="brand-heading">Built for the work ahead.</h2>
  </section>
}
