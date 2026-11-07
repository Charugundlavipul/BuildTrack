import { useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  domMax,
  m,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react'
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  Compass,
  HardHat,
  Layers,
  Mail,
  Menu,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react'
import { Brand } from '../../components/Brand'
import './marketing.css'

const heroPlates = [
  {
    id: 'residence',
    code: '01',
    label: 'Completed residence',
    location: 'PACIFIC NORTHWEST · CUSTOM RESIDENCE',
    caption: 'Every detail verified before handover.',
    image: '/images/hero-editorial-residence.jpg',
    imageAlt: 'Modern architectural residence at twilight with warm interior lighting, cedar siding, and glass pavilions',
  },
  {
    id: 'community',
    code: '02',
    label: 'Active neighborhood',
    location: 'CEDAR GROVE · 24 HOMES IN PROGRESS',
    caption: 'Field supervision and trade partners aligned across every lot.',
    image: '/images/buildtrack-construction.webp',
    imageAlt: 'Active residential neighborhood construction with timber framing and completed homes at golden hour',
  },
  {
    id: 'craft',
    code: '03',
    label: 'Interior finish',
    location: 'LOT 104 · ARCHITECTURAL MILLWORK',
    caption: 'Room-by-room inspections with an auditable repair trail.',
    image: '/images/workflow-verify.jpg',
    imageAlt: 'Quality inspector verifying custom kitchen cabinetry alignment in a newly built residence',
  },
]

const workflow = [
  {
    label: 'Capture',
    role: 'INSPECTOR',
    title: 'Find it in the field.',
    description: 'Record an observation in the right home and room. Keep the details, photos, and conversation together.',
    status: 'Observation recorded',
    room: 'Kitchen · Cabinetry',
    message: 'Upper cabinet door needs alignment.',
    image: '/images/workflow-capture.jpg',
    imageAlt: 'Residential inspector documenting an upper kitchen cabinet hinge alignment observation on a rugged tablet',
    telemetryLabel: 'OPTICAL PIN · HINGE CLEARANCE',
    telemetryMetric: '±3.2 mm offset logged',
    icon: ClipboardCheck,
  },
  {
    label: 'Assign',
    role: 'CONSTRUCTION SUPERVISOR',
    title: 'Give every issue an owner.',
    description: 'Review the observation and assign the repair to an eligible vendor. The company manager dispatches the right person.',
    status: 'Assigned for repair',
    room: 'Cedar Finish Carpentry',
    message: 'Cabinet repair assigned to the carpentry team.',
    image: '/images/workflow-assign.jpg',
    imageAlt: 'Construction supervisor and trade partner reviewing architectural plans and dispatching repair work on site',
    telemetryLabel: 'TRADE DISPATCH · SLA ACTIVE',
    telemetryMetric: 'Routed to finish carpentry crew',
    icon: HardHat,
  },
  {
    label: 'Repair',
    role: 'VENDOR TRADESMAN',
    title: 'Keep the repair moving.',
    description: 'The assigned tradesperson records progress, adds evidence, and submits the completed repair for review.',
    status: 'Ready for verification',
    room: 'Kitchen · Cabinetry',
    message: 'Hinges adjusted. Repair submitted for review.',
    image: '/images/workflow-repair.jpg',
    imageAlt: 'Finish carpenter adjusting a concealed European cabinet hinge in a newly built residential kitchen',
    telemetryLabel: 'TORQUE & REVEAL CALIBRATION',
    telemetryMetric: '2.0 mm uniform reveal restored',
    icon: Wrench,
  },
  {
    label: 'Verify',
    role: 'INSPECTOR',
    title: 'Close it with confidence.',
    description: 'An independent Inspector checks the selected observation on site. The repair and its history stay in the original thread.',
    status: 'Repair accepted',
    room: 'Kitchen · Cabinetry',
    message: 'Alignment checked on site. Observation closed.',
    image: '/images/workflow-verify.jpg',
    imageAlt: 'Quality inspector verifying plumb and level cabinet door alignment with a precision spirit level',
    telemetryLabel: 'INDEPENDENT FIELD SIGN-OFF',
    telemetryMetric: '0.0° plumb verified on site',
    icon: CheckCheck,
  },
]

const teams = [
  {
    label: 'Builder leadership',
    scopeTag: 'ORGANIZATION & DIVISION SCOPE',
    roles: [
      ['Org Admin', 'Manage organization settings, roles, people, divisions, vendors, and operations.'],
      ['Divisional Admin', 'Manage users, neighborhoods, vendors, plans, and operations in assigned divisions.'],
      ['Area Construction Manager', 'Onboard homes, manage local users and vendors, and resolve escalations in assigned neighborhoods.'],
    ],
  },
  {
    label: 'Field teams',
    scopeTag: 'NEIGHBORHOOD & LOT SCOPE',
    roles: [
      ['Construction Supervisor', 'Schedule inspections, review findings, assign repairs, and verify completed work.'],
      ['Internal contributor', 'Report issues, carry out assigned internal work, and keep progress up to date.'],
      ['Inspector', 'Complete assigned inspections, record room observations, and perform assigned reinspections. Add this role to internal staff or a vendor-company user.'],
    ],
  },
  {
    label: 'Trade partners',
    scopeTag: 'COMPANY & ASSIGNED WORK SCOPE',
    roles: [
      ['Vendor Manager', 'Manage your own company’s users and dispatch its assigned work and inspections.'],
      ['Vendor Tradesman', 'Complete your assigned repairs, post progress, and submit completion evidence.'],
    ],
  },
]

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <m.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </m.div>
  )
}

export function MarketingPage() {
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const canvasScale = useSpring(useTransform(scrollYProgress, [0, 0.25], [1, 0.965]), { stiffness: 90, damping: 26 })
  const canvasY = useSpring(useTransform(scrollYProgress, [0, 0.25], [0, -18]), { stiffness: 90, damping: 26 })

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const imagePanX = useSpring(useTransform(pointerX, [-0.5, 0.5], [14, -14]), { stiffness: 80, damping: 24 })
  const imagePanY = useSpring(useTransform(pointerY, [-0.5, 0.5], [10, -10]), { stiffness: 80, damping: 24 })
  const frameRotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-2.2, 2.2]), { stiffness: 100, damping: 24 })
  const frameRotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [1.8, -1.8]), { stiffness: 100, damping: 24 })

  const [menu, setMenu] = useState(false)
  const [plateIndex, setPlateIndex] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)
  const [step, setStep] = useState(0)
  const [team, setTeam] = useState(0)
  const [offlineMode, setOfflineMode] = useState<'offline' | 'syncing'>('offline')
  const [draft, setDraft] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const active = workflow[step]
  const StepIcon = active.icon
  const activePlate = heroPlates[plateIndex]

  useEffect(() => {
    const title = document.title
    document.title = 'BuildTrack | Residential Construction Quality'
    return () => {
      document.title = title
    }
  }, [])

  useEffect(() => {
    if (reduce || heroPaused) return
    const timer = window.setInterval(() => {
      setPlateIndex((current) => (current + 1) % heroPlates.length)
    }, 5600)
    return () => window.clearInterval(timer)
  }, [reduce, heroPaused])

  useEffect(() => {
    if (!menu) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false)
        menuButton.current?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])

  function handleHeroMouseMove(event: ReactMouseEvent<HTMLElement>) {
    if (reduce) return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5)
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5)
  }

  function handleHeroMouseLeave() {
    pointerX.set(0)
    pointerY.set(0)
    setHeroPaused(false)
  }

  function requestDemo() {
    setMenu(false)
    setDraft('')
    dialog.current?.showModal()
  }

  function prepareInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const body = `Hello BuildTrack,\n\nI would like a demo for ${data.get('company')}.\n\nName: ${data.get('name')}\nWork email: ${data.get('email')}\nAnnual home volume: ${data.get('volume') || 'Not specified'}\n\nWhat we would like to discuss:\n${data.get('message') || 'Construction quality and workflow management.'}`
    setDraft(`mailto:support@vkr-ventures.com?subject=${encodeURIComponent('BuildTrack demo request — ' + data.get('company'))}&body=${encodeURIComponent(body)}`)
  }

  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <div className="bt-sales">
          <a className="sales-skip" href="#sales-main">Skip to content</a>
          <header className="sales-nav">
            <a href="#" aria-label="BuildTrack home"><Brand /></a>
            <button
              className="sales-menu-toggle"
              ref={menuButton}
              aria-label={menu ? 'Close menu' : 'Open menu'}
              aria-expanded={menu}
              aria-controls="sales-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
            <nav id="sales-navigation" className={menu ? 'is-open' : ''} aria-label="Website navigation">
              <a href="#workflow" onClick={() => setMenu(false)}>How it works</a>
              <a href="#teams" onClick={() => setMenu(false)}>For your team</a>
              <a href="#field" onClick={() => setMenu(false)}>Built for the field</a>
              <Link to="/login" className="sales-login">Sign in <ArrowRight /></Link>
              <button className="sales-button sales-button-primary" onClick={requestDemo}>Request a demo <ArrowRight /></button>
            </nav>
          </header>

          <main id="sales-main">
            {/* Squarespace-inspired Full-Viewport Editorial Architectural Hero */}
            <section className="sales-hero" aria-labelledby="sales-heading">
              <div className="sales-container sales-hero-inner">
                <m.figure
                  className="sales-construction sales-hero-showcase"
                  initial={reduce ? false : { opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
                  style={
                    reduce
                      ? undefined
                      : {
                          scale: canvasScale,
                          y: canvasY,
                          rotateX: frameRotateX,
                          rotateY: frameRotateY,
                        }
                  }
                  onMouseEnter={() => setHeroPaused(true)}
                  onMouseMove={handleHeroMouseMove}
                  onMouseLeave={handleHeroMouseLeave}
                >
                  {/* Full-Bleed Architectural Photography with Framer Motion Pan & Scale */}
                  <div className="sales-hero-media">
                    <AnimatePresence mode="wait">
                      <m.img
                        key={activePlate.image}
                        src={activePlate.image}
                        alt={activePlate.imageAlt}
                        width={1600}
                        height={900}
                        className="sales-hero-photo"
                        initial={reduce ? false : { opacity: 0, scale: 1.08 }}
                        animate={{ opacity: 1, scale: 1.03 }}
                        exit={{ opacity: 0, scale: 1.01 }}
                        transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
                        style={
                          reduce
                            ? undefined
                            : {
                                x: imagePanX,
                                y: imagePanY,
                              }
                        }
                      />
                    </AnimatePresence>
                    <div className="sales-hero-scrim" aria-hidden="true" />
                  </div>

                  {/* Clean Squarespace-style Editorial Overlay */}
                  <div className="sales-hero-overlay">
                    <m.div
                      className="sales-hero-editorial"
                      initial={reduce ? false : { opacity: 0, y: 22 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.75, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="sales-hero-eyebrow">RESIDENTIAL CONSTRUCTION QUALITY</p>
                      <h1 id="sales-heading">
                        Crafted for the builders
                        <span>who stand behind every home.</span>
                      </h1>
                      <p className="sales-hero-subcopy">
                        Unite field inspections, neighborhood supervision, and trade partners in one quiet, rigorous workspace.
                      </p>
                      <div className="sales-hero-actions">
                        <button className="sales-button sales-button-ivory" onClick={requestDemo}>
                          Request a demo <ArrowRight />
                        </button>
                        <a className="sales-hero-link" href="#workflow">
                          Explore how it works <ArrowDown />
                        </a>
                      </div>
                    </m.div>

                    {/* Minimal Bottom Architectural Plate Bar */}
                    <div className="sales-hero-footer-bar">
                      <AnimatePresence mode="wait">
                        <m.figcaption
                          key={activePlate.id}
                          className="sales-hero-caption"
                          initial={reduce ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.3 }}
                        >
                          <span>{activePlate.location}</span>
                          <strong>{activePlate.caption}</strong>
                        </m.figcaption>
                      </AnimatePresence>

                      <div className="sales-hero-plates" role="tablist" aria-label="Architectural perspectives">
                        {heroPlates.map((plate, index) => {
                          const selected = plateIndex === index
                          return (
                            <button
                              key={plate.id}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              className={selected ? 'sales-plate-tab is-active' : 'sales-plate-tab'}
                              onClick={() => setPlateIndex(index)}
                            >
                              {selected && (
                                <m.span
                                  layoutId="hero-plate-pill"
                                  className="sales-plate-pill"
                                  transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                                />
                              )}
                              <span className="sales-plate-code">{plate.code}</span>
                              <span className="sales-plate-label">{plate.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </m.figure>
              </div>
            </section>

            <section id="workflow" className="sales-workflow sales-container" aria-labelledby="workflow-heading">
              <Reveal className="sales-section-heading">
                <p className="sales-kicker">01 / A CONNECTED WORKFLOW</p>
                <div>
                  <h2 id="workflow-heading">An issue is only resolved<br />when the loop is closed.</h2>
                  <p>Keep the people, decisions, and evidence connected. Follow one observation from the field to a verified repair.</p>
                </div>
              </Reveal>

              <Reveal className="sales-workflow-body">
                <div className="sales-workflow-controls" role="group" aria-label="Explore the workflow">
                  {workflow.map((item, index) => {
                    const isActive = step === index
                    const isPassed = step > index
                    return (
                      <button
                        key={item.label}
                        aria-pressed={isActive}
                        className={isActive ? 'is-active' : isPassed ? 'is-passed' : ''}
                        onClick={() => setStep(index)}
                      >
                        {isActive && (
                          <m.span
                            layoutId="workflow-active-bar"
                            className="sales-step-indicator"
                            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span className="sales-step-number">0{index + 1}</span>
                        <span className="sales-step-label">{item.label}</span>
                        {isPassed ? <Check className="sales-step-icon is-check" /> : <ArrowRight className="sales-step-icon" />}
                      </button>
                    )
                  })}
                </div>

                <div className="sales-workflow-stage">
                  <div className="sales-example-label">
                    <span>FIELD WALKTHROUGH · STEP 0{step + 1} OF 04</span>
                    <span>LOT 104 / KITCHEN</span>
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    <m.div
                      key={step}
                      className="sales-step-content"
                      initial={{ opacity: 0, y: reduce ? 0 : 16, rotateX: reduce ? 0 : 4 }}
                      animate={{ opacity: 1, y: 0, rotateX: 0 }}
                      exit={{ opacity: 0, y: reduce ? 0 : -12, rotateX: reduce ? 0 : -3 }}
                      transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="sales-step-copy">
                        <div className="sales-step-copy-head">
                          <p className="sales-kicker">{active.role}</p>
                          <h3>{active.title}</h3>
                        </div>
                        <p>{active.description}</p>
                      </div>

                      <div className="sales-step-scene" data-step={step + 1}>
                        <div className="sales-step-media">
                          <m.img
                            key={active.image}
                            src={active.image}
                            alt={active.imageAlt}
                            width={1024}
                            height={572}
                            initial={reduce ? false : { scale: 1.06, opacity: 0.4 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                          />
                          <div className="sales-step-media-scrim" aria-hidden="true" />

                          {/* Themed Framer Motion overlay per step */}
                          <div className="sales-step-hud" aria-hidden="true">
                            {step === 0 && (
                              <m.div
                                className="sales-hud-reticle"
                                initial={reduce ? false : { scale: 0.82, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.45, delay: 0.1 }}
                              >
                                <m.span
                                  className="sales-reticle-ring"
                                  animate={reduce ? undefined : { scale: [1, 1.14, 1], opacity: [0.85, 0.35, 0.85] }}
                                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                                />
                                <span className="sales-reticle-core" />
                                <span className="sales-reticle-tag">PIN #104–01 · UPPER HINGE</span>
                              </m.div>
                            )}

                            {step === 1 && (
                              <m.div
                                className="sales-hud-route"
                                initial={reduce ? false : { opacity: 0, x: -14 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.4, delay: 0.1 }}
                              >
                                <span className="sales-route-node"><Compass />Supervisor review</span>
                                <m.span
                                  className="sales-route-line"
                                  initial={reduce ? false : { scaleX: 0 }}
                                  animate={{ scaleX: 1 }}
                                  transition={{ duration: 0.45, delay: 0.18 }}
                                />
                                <span className="sales-route-node is-destination"><HardHat />Cedar Finish Carpentry</span>
                              </m.div>
                            )}

                            {step === 2 && (
                              <m.div
                                className="sales-hud-calibration"
                                initial={reduce ? false : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.1 }}
                              >
                                <div className="sales-calibration-head">
                                  <Layers />
                                  <span>HINGE ALIGNMENT TOLERANCE</span>
                                  <strong>2.0 mm</strong>
                                </div>
                                <div className="sales-calibration-track">
                                  <m.span
                                    className="sales-calibration-fill"
                                    initial={reduce ? false : { width: '18%' }}
                                    animate={{ width: '100%' }}
                                    transition={{ duration: 0.65, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
                                  />
                                </div>
                              </m.div>
                            )}

                            {step === 3 && (
                              <m.div
                                className="sales-hud-verified"
                                initial={reduce ? false : { scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.4, delay: 0.1 }}
                              >
                                <m.span
                                  className="sales-laser-line"
                                  initial={reduce ? false : { scaleX: 0 }}
                                  animate={{ scaleX: 1 }}
                                  transition={{ duration: 0.5, delay: 0.12 }}
                                />
                                <div className="sales-verified-pill">
                                  <Sparkles />
                                  <span>PLUMB &amp; LEVEL CONFIRMED ON SITE</span>
                                </div>
                              </m.div>
                            )}
                          </div>

                          <div className="sales-step-badges">
                            <span className="sales-step-id"><StepIcon />Observation #104–01</span>
                            <span className={step === 3 ? 'sales-status is-verified' : 'sales-status'}>{active.status}</span>
                          </div>
                        </div>

                        <div className="sales-step-caption">
                          <span className="sales-avatar"><StepIcon /></span>
                          <span className="sales-room-label">{active.room}</span>
                          <strong className="sales-caption-title">Align upper cabinet door</strong>
                          <span className="sales-caption-sep" aria-hidden="true">·</span>
                          <p className="sales-caption-msg">{active.message}</p>
                          <span className="sales-telemetry-chip">{active.telemetryMetric}</span>
                        </div>
                      </div>
                    </m.div>
                  </AnimatePresence>

                  <div className="sales-workflow-progress" aria-hidden="true">
                    {workflow.map((item, index) => (
                      <span key={item.label} className={index <= step ? 'is-complete' : ''} />
                    ))}
                  </div>
                </div>
              </Reveal>
            </section>

            <section id="teams" className="sales-team-section" aria-labelledby="teams-heading">
              <div className="sales-container">
                <Reveal className="sales-section-heading">
                  <p className="sales-kicker">02 / CLEAR RESPONSIBILITIES</p>
                  <div>
                    <h2 id="teams-heading">One platform.<br />Everyone knows their part.</h2>
                    <p>Connect your organization, divisions, neighborhoods, and vendor companies—with access that follows responsibility.</p>
                  </div>
                </Reveal>
                <Reveal className="sales-team-layout">
                  <div className="sales-team-tabs" role="group" aria-label="Explore team roles">
                    {teams.map((item, index) => (
                      <button
                        aria-pressed={team === index}
                        className={team === index ? 'is-active' : ''}
                        key={item.label}
                        onClick={() => setTeam(index)}
                      >
                        <span>{item.label}</span>
                        <ChevronRight />
                      </button>
                    ))}
                    <p>Role availability and permissions can be configured by your administrators.</p>
                  </div>
                  <div className="sales-team-roles" aria-live="polite">
                    <div className="sales-team-scope-banner">
                      <span>{teams[team].scopeTag}</span>
                      <span>ROLE HIERARCHY</span>
                    </div>
                    <AnimatePresence mode="wait">
                      <m.div
                        key={teams[team].label}
                        initial={reduce ? false : { opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.28 }}
                      >
                        {teams[team].roles.map(([name, description], index) => (
                          <m.article
                            key={name}
                            initial={reduce ? false : { opacity: 0, x: 14 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3, delay: index * 0.06 }}
                            whileHover={reduce ? undefined : { x: 6 }}
                          >
                            <span>0{index + 1}</span>
                            <div>
                              <h3>{name}</h3>
                              <p>{description}</p>
                            </div>
                          </m.article>
                        ))}
                      </m.div>
                    </AnimatePresence>
                  </div>
                </Reveal>
              </div>
            </section>

            <section id="field" className="sales-field sales-container" aria-labelledby="field-heading">
              <Reveal className="sales-field-heading">
                <p className="sales-kicker">03 / MADE FOR SITE LIFE</p>
                <h2 id="field-heading">The work doesn’t stop<br />at the edge of a signal.</h2>
                <p>Open a home or inspection while connected. Keep working with saved information when the signal drops. Queued changes synchronize automatically when you reconnect.</p>
                <Link className="sales-text-link" to="/login">Open your workspace <ArrowRight /></Link>
              </Reveal>
              <Reveal className="sales-field-visual">
                <div className="sales-field-visual-top">
                  <span>
                    {offlineMode === 'offline' ? <WifiOff /> : <Wifi />}
                    {offlineMode === 'offline' ? 'Working offline' : 'Signal restored · Syncing queue'}
                  </span>
                  <button
                    type="button"
                    className="sales-field-mode-toggle"
                    onClick={() => setOfflineMode(offlineMode === 'offline' ? 'syncing' : 'offline')}
                  >
                    <RefreshCw className={offlineMode === 'syncing' ? 'is-spinning' : ''} />
                    <span>{offlineMode === 'offline' ? 'Simulate reconnect' : 'Simulate offline'}</span>
                  </button>
                </div>
                <m.div
                  className="sales-field-record"
                  layout
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                >
                  <div className="sales-field-record-head">
                    <div>
                      <p>LOT 104 / CEDAR GROVE</p>
                      <h3>Kitchen inspection</h3>
                    </div>
                    <span className={offlineMode === 'syncing' ? 'sales-sync-pill is-online' : 'sales-sync-pill'}>
                      {offlineMode === 'offline' ? '3 changes queued locally' : 'All changes synced'}
                    </span>
                  </div>
                  <div><ClipboardCheck /><span>Record observations in the right room</span><Check /></div>
                  <div><MessageSquare /><span>Keep your changes on this device</span><Check /></div>
                  <div><ShieldCheck /><span>Synchronize when you reconnect</span><Check /></div>
                </m.div>
                <p className="sales-field-footnote">Saved information is available for up to 24 hours. Device storage and current access rules apply.</p>
              </Reveal>
            </section>

            <section className="sales-contact" aria-labelledby="sales-contact-heading">
              <div className="sales-container">
                <Reveal>
                  <p className="sales-kicker">LET’S BUILD A BETTER WORKFLOW</p>
                  <h2 id="sales-contact-heading">More clarity on site.<br />More confidence at handover.</h2>
                  <div className="sales-contact-bottom">
                    <p>See how BuildTrack could fit your homes,<br />your teams, and your way of building.</p>
                    <button className="sales-button sales-button-amber" onClick={requestDemo}>Request a demo <ArrowRight /></button>
                  </div>
                </Reveal>
              </div>
            </section>
          </main>

          <footer className="sales-footer sales-container">
            <a href="#" aria-label="Back to top"><Brand /></a>
            <p>Construction quality, from field to finish.</p>
            <a href="mailto:support@vkr-ventures.com">Contact <ArrowRight /></a>
            <Link to="/login">Sign in <ArrowRight /></Link>
          </footer>

          <dialog className="sales-demo-dialog" ref={dialog} aria-labelledby="demo-heading">
            <button className="sales-dialog-close" aria-label="Close demo request" onClick={() => dialog.current?.close()}><X /></button>
            <p className="sales-kicker">LET’S TALK BUILDTRACK</p>
            <h2 id="demo-heading">Your team. Your workflow.</h2>
            <p>Tell us a little about your company and what you’d like to see.</p>
            <form onSubmit={prepareInquiry} onChange={() => setDraft('')}>
              <label>Your name<input name="name" autoComplete="name" required maxLength={120} /></label>
              <label>Company<input name="company" autoComplete="organization" required maxLength={160} /></label>
              <label>Work email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
              <label>Homes built per year
                <select name="volume" defaultValue="">
                  <option value="">Choose if applicable</option>
                  <option>Under 100</option>
                  <option>100–500</option>
                  <option>501–2,000</option>
                  <option>Over 2,000</option>
                </select>
              </label>
              <label className="sales-form-wide">What would you like to improve?<textarea name="message" rows={3} maxLength={2000} placeholder="Inspections, vendor coordination, repair follow-up…" /></label>
              <p className="sales-form-wide sales-form-note">This prepares an email draft to support@vkr-ventures.com. Nothing is submitted or sent automatically.</p>
              <div className="sales-form-wide">
                {draft ? (
                  <div role="status" className="sales-draft-ready">
                    <p>Your inquiry is ready. Open the draft and send it from your email app.</p>
                    <a href={draft} className="sales-button sales-button-primary"><Mail />Open email draft</a>
                  </div>
                ) : (
                  <button className="sales-button sales-button-primary">Prepare demo inquiry <ArrowRight /></button>
                )}
              </div>
            </form>
          </dialog>
        </div>
      </MotionConfig>
    </LazyMotion>
  )
}
