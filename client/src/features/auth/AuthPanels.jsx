import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { BrandMark } from "../../components/Branding";
import { demoAccounts } from "../../data/menu";
import { gsap, prefersReducedMotion, useGSAP } from "../../lib/gsap";
import { api } from "../../services/api";
import {
  completeTwoFactorSession,
  firebaseEnabled,
  friendlyAuthError,
  login,
  logout,
  refreshEmailVerification,
  registerCustomer,
  resendVerificationEmail,
  resetPassword
} from "../../services/firebase";
import { authenticateCustomerPasskey, passkeysSupported, registerCustomerPasskey } from "../../services/passkeys";

const loginRoleOptions = [
  { id: "customer", label: "Customer", detail: "Order meals" },
  { id: "owner", label: "Owner", detail: "Run the store" },
  { id: "staff", label: "Staff", detail: "Serve orders" },
  { id: "rider", label: "Rider", detail: "Deliver food" }
];

const popularMeals = [
  { name: "Porkchop Meal", detail: "Crispy comfort meal with rice, egg, and soup.", price: "Starts at ₱99", image: "/assets/menu/porkchop.png" },
  { name: "Tapa Meal", detail: "Pinoy tapsilog favorite for breakfast, lunch, or late cravings.", price: "Starts at ₱99", image: "/assets/menu/tapa.png" },
  { name: "Sisig Meal", detail: "Savory house-style sisig served as a filling rice meal.", price: "Starts at ₱99", image: "/assets/menu/sisig.png" },
  { name: "Chicken Wings Meal", detail: "Golden chicken wings with rice and a familiar Pinoy bite.", price: "Starts at ₱99", image: "/assets/menu/chicken-wings.png" },
  { name: "Boneless Chicken Meal", detail: "Easy-to-eat boneless chicken for quick dine-in or delivery.", price: "Starts at ₱99", image: "/assets/menu/boneless-chicken.png" },
  { name: "Dinuguan Meal", detail: "Special weekend-style Filipino comfort dish.", price: "Starts at ₱85", image: "/assets/menu/dinuguan.png" }
];

const tapTapStrengths = [
  { tag: "Sulit meals", title: "Affordable Pinoy meals", detail: "Budget-friendly rice meals, solo servings, drinks, and add-ons for everyday foodtrips." },
  { tag: "Kitchen fresh", title: "Freshly prepared favorites", detail: "Meals are prepared for fast service while keeping the familiar TapTap taste." },
  { tag: "Flexible handoff", title: "Pickup and delivery ready", detail: "Choose pickup or delivery and get clear updates while your order moves." },
  { tag: "Local care", title: "Friendly local service", detail: "Built for students, workers, families, and nearby customers who want sulit meals." }
];

const orderSteps = [
  { tag: "Browse", title: "Choose your meal", detail: "Browse tapsilog, rice meals, alacarte, solo, drinks, and specials." },
  { tag: "Confirm", title: "Confirm pickup or delivery", detail: "Add your phone, address, landmark, and delivery pin when needed." },
  { tag: "Enjoy", title: "Receive your order", detail: "Track updates from kitchen preparation to pickup, delivery, or dine-in service." }
];

const serviceOptions = [
  { tag: "Delivery pin", title: "Delivery", detail: "Save your address, landmark, phone number, and exact drop-off pin for smoother delivery." },
  { tag: "Order ahead", title: "Pickup", detail: "Collect meals without waiting through the full counter line." },
  { tag: "Counter ready", title: "Walk-in", detail: "Drop by for dine-in or takeout when you want your meal served straight from the counter." }
];

const homepageHighlights = [
  { value: "P69+", label: "Budget-friendly meals" },
  { value: "3 ways", label: "Delivery, pickup, walk-in" },
  { value: "1 account", label: "Orders, receipts, reviews" }
];

function LoginPanel({ onLoggedIn }) {
  const registrationRequested = new URLSearchParams(window.location.search).get("register") === "true";
  const registrationStepDefaults = [
    { id: "auth", label: "Account sign-in", detail: "Waiting to create your secure login.", status: "pending" },
    { id: "profile", label: "Customer profile", detail: "Waiting to save your profile.", status: "pending" },
    { id: "verification", label: "Verification email", detail: "Waiting to request your verification email.", status: "pending" },
    { id: "session", label: "Final setup", detail: "Waiting to finish your account setup.", status: "pending" }
  ];
  const [role, setRole] = useState("customer");
  const [registering, setRegistering] = useState(registrationRequested);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(registrationRequested ? "" : demoAccounts.customer.email);
  const [password, setPassword] = useState(registrationRequested ? "" : demoAccounts.customer.password);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [registrationSteps, setRegistrationSteps] = useState(registrationStepDefaults);
  const [registrationResult, setRegistrationResult] = useState(null);
  const [loginModalOpen, setLoginModalOpen] = useState(registrationRequested);
  const [teamAccessOpen, setTeamAccessOpen] = useState(false);
  const loginHomeRef = useRef(null);
  const loginModalRef = useRef(null);
  const lastFocusedElementRef = useRef(null);

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const isSmallScreen = window.matchMedia?.("(max-width: 620px)")?.matches;

    gsap.from("[data-login-nav], [data-login-hero]", {
      y: 24,
      autoAlpha: 0,
      duration: 0.72,
      stagger: 0.08,
      ease: "power3.out"
    });

    if (!isSmallScreen) {
      gsap.to("[data-login-float]", {
        y: -10,
        rotate: 1.5,
        duration: 2.2,
        stagger: 0.18,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
      });
    }

    gsap.utils.toArray("[data-login-section]").forEach((section) => {
      const revealItems = section.querySelectorAll("[data-login-reveal]");
      if (!revealItems.length) return;
      gsap.from(revealItems, {
        y: 34,
        scale: 0.985,
        autoAlpha: 0,
        duration: isSmallScreen ? 0.42 : 0.58,
        stagger: isSmallScreen ? 0.035 : 0.07,
        ease: "power2.out",
        scrollTrigger: {
          trigger: section,
          start: "top 84%",
          once: true
        }
      });
    });
  }, { scope: loginHomeRef });

  useGSAP(() => {
    if (!loginModalOpen || prefersReducedMotion()) return;

    gsap.from("[data-login-modal-panel]", {
      y: 28,
      scale: 0.98,
      autoAlpha: 0,
      duration: 0.32,
      ease: "power3.out"
    });

    gsap.from("[data-login-modal-scrim]", {
      autoAlpha: 0,
      duration: 0.24,
      ease: "power2.out"
    });
  }, { dependencies: [loginModalOpen], scope: loginModalRef });

  useEffect(() => {
    if (!loginModalOpen) return undefined;

    document.body.classList.add("login-modal-open");
    const focusableSelector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
    const focusTimer = window.setTimeout(() => {
      const firstFocusable = loginModalRef.current?.querySelector(focusableSelector);
      firstFocusable?.focus();
    }, 80);

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setLoginModalOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(loginModalRef.current?.querySelectorAll(focusableSelector) || [])
        .filter((element) => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;

      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("login-modal-open");
      window.setTimeout(() => {
        lastFocusedElementRef.current?.focus?.();
      }, 0);
    };
  }, [loginModalOpen]);

  const updateRegistrationStep = (id, status, detail) => {
    setRegistrationSteps((current) => current.map((step) => (
      step.id === id ? { ...step, status, detail } : step
    )));
  };

  const toggleRegistration = () => {
    setRegistering((current) => {
      const next = !current;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("register", "true");
      else url.searchParams.delete("register");
      window.history.replaceState({}, "", url);
      return next;
    });
    setRole("customer");
    setTeamAccessOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    setError("");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const selectRole = (nextRole) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("register");
    window.history.replaceState({}, "", url);
    setRole(nextRole);
    setEmail(demoAccounts[nextRole].email);
    setPassword(demoAccounts[nextRole].password);
    setRegistering(false);
    setTeamAccessOpen(nextRole !== "customer");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const openLoginModal = (preferredRole) => {
    lastFocusedElementRef.current = document.activeElement;
    if (preferredRole && !registering) selectRole(preferredRole);
    if (!preferredRole && role === "customer") setTeamAccessOpen(false);
    setLoginModalOpen(true);
  };

  const closeLoginModal = () => {
    setLoginModalOpen(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (registering) {
      setRegistrationResult(null);
      setRegistrationSteps(registrationStepDefaults);
    }
    try {
      if (registering) {
        const result = await registerCustomer(name, email, password, updateRegistrationStep);
        setRegistrationResult(result);
        setPassword("");
      } else {
        await login(email, password, role, demoAccounts);
        onLoggedIn?.();
      }
    } catch (authError) {
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = busy
    ? registering ? "Creating your account..." : "Signing in..."
    : registering ? "Create account" : role === "customer" ? "Sign in and order" : `Sign in as ${role}`;

  const loginCard = (
    <form className="login-card" onSubmit={submit} data-login-modal-panel>
      <div className="login-card-header">
        <div className="brand-lockup"><BrandMark /><div><strong>TapTap</strong><small>FOODTRIP</small></div></div>
        <span>{registering ? "Customer signup" : loginRoleOptions.find((item) => item.id === role)?.label}</span>
      </div>
      <p className="eyebrow text-danger">TapTap account</p>
      <h2>{registering ? "Create customer account" : "Welcome back"}</h2>
      <p className="login-card-copy">{firebaseEnabled ? "Sign in to continue your foodtrip." : "Sample accounts are ready for this preview."}</p>
      {!registering && (
        <div className="login-access-choice">
          <button type="button" className={`login-customer-choice ${role === "customer" ? "active" : ""}`} aria-pressed={role === "customer"} onClick={() => selectRole("customer")}>
            <span>
              <strong>Customer ordering</strong>
              <small>Browse meals, checkout, and track orders.</small>
            </span>
          </button>
          <button type="button" className={`login-team-toggle ${teamAccessOpen ? "active" : ""}`} aria-expanded={teamAccessOpen} aria-controls="team-role-options" onClick={() => setTeamAccessOpen((current) => !current)}>
            <span>
              <strong>Team access</strong>
              <small>Owner, staff, and rider sign-in.</small>
            </span>
          </button>
        </div>
      )}
      {!registering && (teamAccessOpen || role !== "customer") && (
        <div className="role-tabs team-role-tabs" id="team-role-options" aria-label="Choose team account role">
          {loginRoleOptions.filter((item) => item.id !== "customer").map((item) => (
            <button type="button" key={item.id} className={role === item.id ? "active" : ""} aria-pressed={role === item.id} onClick={() => selectRole(item.id)}>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
      )}
      {registering && (
        <label className="form-label">Full name
          <input className="form-control" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      )}
      <label className="form-label">Email
        <input className="form-control" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="form-label">Password
        <span className="login-password-field">
          <input className="form-control" type={showPassword ? "text" : "password"} minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </span>
      </label>
      {registering && (
        <div className="firebase-registration-flow" aria-live="polite">
          <div className="registration-flow-heading">
            <div><strong>Creating your account</strong><small>Setting up your secure customer profile.</small></div>
            <span>{registrationResult ? "Complete" : busy ? "Working" : "Ready"}</span>
          </div>
          {registrationSteps.map((step) => (
            <div className={`registration-step registration-${step.status}`} key={step.id}>
              <span className="registration-step-icon" aria-hidden="true" />
              <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            </div>
          ))}
          {registrationResult && (
            <div className="registration-result">
              <strong>Customer account created</strong>
              <span>Your account is ready. Please check your email to verify it.</span>
              <span>{registrationResult.verificationSent ? "Verification email requested." : "Verification email still needs to be resent."}</span>
            </div>
          )}
        </div>
      )}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <button className="btn btn-danger w-100 login-submit-button" disabled={busy}>
        {submitLabel}
      </button>
      <div className="login-secondary-actions">
        <button type="button" className="btn btn-outline-danger btn-sm" onClick={toggleRegistration}>
          {registering ? "Back to sign in" : "Customer registration"}
        </button>
        {!registering && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => resetPassword(email).catch((resetError) => setError(resetError.message))}>Reset password</button>}
      </div>
    </form>
  );

  return (
    <main className="login-home" ref={loginHomeRef}>
      <header className="login-home-header" data-login-nav>
        <a className="brand-lockup login-home-brand" href="#home" aria-label="TapTap Foodtrip home">
          <BrandMark />
          <div><strong>TapTap</strong><small>FOODTRIP</small></div>
        </a>
        <nav className="login-home-nav" aria-label="Homepage sections">
          <a href="#about-taptap">About</a>
          <a href="#popular-meals">Meals</a>
          <a href="#service-options">Services</a>
          <a href="#how-ordering-works">How it works</a>
        </nav>
        <button type="button" className="btn btn-danger login-nav-cta" onClick={() => openLoginModal()}>
          Order now
        </button>
      </header>

      <section className="login-screen" id="home" aria-label="TapTap Foodtrip homepage">
      <div className="login-visual">
        <div className="login-restaurant-top" data-login-hero>
          <div className="brand-lockup"><BrandMark /><div><strong>TapTap</strong><small>FOODTRIP</small></div></div>
          <span>Fresh from the kitchen</span>
        </div>
        <div className="login-restaurant-copy">
          <p className="eyebrow" data-login-hero>Pinoy tapsilog house</p>
          <h1 data-login-hero>Traditional Pinoy comfort, served fast.</h1>
          <div className="login-hero-message" data-login-hero>
            <span>We sell</span>
            <strong>traditional Pinoy Style Tapsilog</strong>
            <span>at the lowest price with quality taste and service.</span>
          </div>
          <div className="login-hero-badges" aria-label="TapTap food promise" data-login-hero>
            <span>Hot rice meals</span>
            <span>Friendly local service</span>
            <span>Pickup or delivery</span>
          </div>
          <div className="login-hero-actions" data-login-hero>
            <button type="button" className="btn btn-warning" onClick={() => openLoginModal("customer")}>Order now</button>
            <a className="btn btn-outline-light" href="#popular-meals">View meals</a>
            <button type="button" className="btn btn-danger" onClick={() => openLoginModal()}>Customer sign in</button>
          </div>
          <div className="login-plate-row" aria-label="TapTap favorite meals">
            <article data-login-hero data-login-float>
              <img src="/assets/menu/tapa.png" alt="Tapa meal" />
              <span>Tapa Meal</span>
            </article>
            <article data-login-hero data-login-float>
              <img src="/assets/menu/porkchop.png" alt="Porkchop meal" />
              <span>Porkchop</span>
            </article>
            <article data-login-hero data-login-float>
              <img src="/assets/menu/sisig.png" alt="Sisig meal" />
              <span>Sisig Meal</span>
            </article>
          </div>
        </div>
        <div className="login-special-card" aria-label="TapTap service promise" data-login-hero data-login-float>
          <span>TapTap promise</span>
          <strong>Hot meals, clear orders, friendly service.</strong>
          <small>Made for nearby customers who want a fast, sulit foodtrip.</small>
        </div>
      </div>
      <div className="login-home-panel" data-login-hero>
        <p className="eyebrow text-danger">Ready for orders</p>
        <h2>Browse meals first. Sign in when you are ready.</h2>
        <div className="login-panel-message">
          <span>Customer-first ordering</span>
          <strong>Your TapTap foodtrip starts with the meal.</strong>
          <small>Check favorites, pick delivery or pickup, then sign in only when it is time to confirm.</small>
        </div>
        <div className="login-highlight-list">
          {homepageHighlights.map((item) => (
            <article key={item.label} data-login-float>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </article>
          ))}
        </div>
        <button type="button" className="btn btn-danger w-100 login-panel-cta" onClick={() => openLoginModal("customer")}>
          Start foodtrip
        </button>
      </div>
      </section>

      <section className="login-business-section login-business-intro" id="about-taptap" data-login-section>
        <div className="login-section-heading" data-login-reveal>
          <p className="eyebrow text-danger">Local Filipino food business</p>
          <h2>Affordable TapTap meals for everyday cravings.</h2>
          <p><span className="login-inline-pill">Rice meals</span> <span className="login-inline-pill">Solo servings</span> <span className="login-inline-pill">Drinks</span> <span className="login-inline-pill">Specials</span></p>
          <p>Classic Filipino comfort food presented in a simple ordering flow for customers who want fast, sulit, and familiar meals.</p>
        </div>
        <div className="login-business-grid">
          <article data-login-reveal>
            <small className="login-card-kicker">Meal line</small>
            <strong>Rice meals</strong>
            <span>Tapsilog-style favorites with egg, rice, soup, and hearty ulam choices.</span>
          </article>
          <article data-login-reveal>
            <small className="login-card-kicker">Flexible portions</small>
            <strong>Ala carte and solo</strong>
            <span>Flexible servings for dine-in, takeout, delivery, or lighter meals.</span>
          </article>
          <article data-login-reveal>
            <small className="login-card-kicker">Quick pairings</small>
            <strong>Drinks and add-ons</strong>
            <span>Simple add-ons for walk-in customers and quick meal pairings.</span>
          </article>
        </div>
      </section>

      <section className="login-business-section" id="popular-meals" data-login-section>
        <div className="login-section-heading compact" data-login-reveal>
          <p className="eyebrow text-danger">Popular choices</p>
          <h2>Foodtrip favorites customers can quickly recognize.</h2>
        </div>
        <div className="login-meal-showcase">
          {popularMeals.map((meal) => (
            <article className="login-meal-card" key={meal.name} data-login-reveal>
              <img src={meal.image} alt={meal.name} loading="lazy" />
              <div>
                <span className="login-meal-tag">TapTap pick</span>
                <strong>{meal.name}</strong>
                <p>{meal.detail}</p>
                <span className="login-price-pill">{meal.price}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-why-section" data-login-section>
        <div className="login-section-heading" data-login-reveal>
          <p className="eyebrow text-danger">Why customers choose TapTap</p>
          <h2>Simple food service, built around speed and value.</h2>
        </div>
        <div className="login-strength-grid">
          {tapTapStrengths.map((item) => (
            <article key={item.title} data-login-reveal>
              <small className="login-card-kicker">{item.tag}</small>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-service-section" id="service-options" data-login-section>
        <div className="login-section-heading" data-login-reveal>
          <p className="eyebrow text-danger">Service options</p>
          <h2>Built for nearby cravings, pickup plans, and exact drop-off pins.</h2>
          <p>Choose how you want your meal: delivered to your pin, prepared for pickup, or ordered for dine-in and takeout.</p>
        </div>
        <div className="login-service-grid">
          {serviceOptions.map((item) => (
            <article key={item.title} data-login-reveal>
              <small className="login-card-kicker">{item.tag}</small>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-order-flow-section" id="how-ordering-works" data-login-section>
        <div className="login-section-heading compact" data-login-reveal>
          <p className="eyebrow text-danger">How ordering works</p>
          <h2>Three easy steps from craving to serving.</h2>
        </div>
        <div className="login-step-grid">
          {orderSteps.map((step, index) => (
            <article key={step.title} data-login-reveal>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small className="login-card-kicker">{step.tag}</small>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-role-section" data-login-section>
        <div className="login-section-heading" data-login-reveal>
          <p className="eyebrow text-danger">Ready for your next meal?</p>
          <h2>Start with your favorites, then confirm your foodtrip when you are ready.</h2>
          <p><span className="login-inline-pill">Browse meals</span> <span className="login-inline-pill">Choose delivery</span> <span className="login-inline-pill">Track orders</span></p>
        </div>
        <button type="button" className="btn btn-danger login-bottom-cta" onClick={() => openLoginModal("customer")} data-login-reveal>Order as customer</button>
      </section>

      {loginModalOpen && (
        <div
          className="login-modal-shell"
          aria-labelledby="login-modal-title"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeLoginModal();
          }}
          ref={loginModalRef}
          role="dialog"
        >
          <div className="login-modal-scrim" data-login-modal-scrim onMouseDown={closeLoginModal} />
          <div className="login-modal-panel">
            <button type="button" className="login-modal-close" aria-label="Close sign in" onClick={closeLoginModal}>x</button>
            <span className="login-modal-kicker">{role === "customer" ? "Customer order access" : "Team access"}</span>
            <h2 id="login-modal-title">{registering ? "Create your TapTap account" : role === "customer" ? "Sign in to order" : "Team sign in"}</h2>
            {loginCard}
          </div>
        </div>
      )}
    </main>
  );
}

function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || "");
  const update = (index, nextValue) => {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };
  const paste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted.length) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 6) - 1]?.focus();
  };
  return (
    <div className="otp-inputs" onPaste={paste}>
      {digits.map((digit, index) => (
        <input
          aria-label={`Digit ${index + 1}`}
          autoComplete="one-time-code"
          disabled={disabled}
          inputMode="numeric"
          key={index}
          maxLength="1"
          onChange={(event) => update(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
          }}
          ref={(element) => { refs.current[index] = element; }}
          value={digit}
        />
      ))}
    </div>
  );
}

function EmailVerificationPanel({ user, onVerified }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resend = async () => {
    setBusy("resend");
    setMessage("");
    setError("");
    try {
      const result = await resendVerificationEmail();
      setMessage(result.alreadyVerified
        ? "Your email is verified. You can continue."
        : `A new verification link was sent to ${user.email}. Check Inbox and Spam.`);
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy("");
    }
  };

  const check = async () => {
    setBusy("check");
    setMessage("");
    setError("");
    try {
      const result = await refreshEmailVerification();
      if (!result.verified) {
        setError("Your email is not verified yet. Please open the link in your email, then check again.");
        return;
      }
      onVerified(result.status);
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="security-screen">
      <div className="security-card">
        <p className="eyebrow text-danger">First login verification</p>
        <h2>Verify your email</h2>
        <p>Before setting up account security, open the verification link sent to <strong>{user.email}</strong>.</p>
        <div className="email-verification-actions">
          <a className="btn btn-outline-danger w-100" href="https://mail.google.com/" target="_blank" rel="noreferrer">Open Gmail</a>
          <button className="btn btn-outline-secondary w-100" disabled={Boolean(busy)} onClick={resend}>
            {busy === "resend" ? "Sending..." : "Resend verification email"}
          </button>
          <button className="btn btn-danger w-100" disabled={Boolean(busy)} onClick={check}>
            {busy === "check" ? "Checking your email..." : "I verified my email, check again"}
          </button>
        </div>
        {message && <div className="alert alert-success py-2 small mt-3">{message}</div>}
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </div>
    </div>
  );
}

function TwoFactorPanel({ user, onComplete }) {
  const status = user.twoFactor || {};
  const setup = !status.enabled;
  const customerAccount = status.role === "customer";
  const browserPasskeysReady = passkeysSupported();
  const [method, setMethod] = useState(status.method || (customerAccount && status.passkeyAvailable ? "passkey" : customerAccount && status.emailOtpAvailable ? "email" : "totp"));
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");

  const beginTotp = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      setSetupData(await api.beginTotpSetup());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await api.sendTwoFactorSms(setup ? "setup" : "challenge");
      setDeliveryMessage(`A six-digit code was sent to ${response.phoneMasked}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await api.sendTwoFactorEmail(setup ? "setup" : "challenge");
      setDeliveryMessage(`A six-digit code was sent to ${response.emailMasked}. Check Inbox and Spam.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const setupPasskey = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await registerCustomerPasskey();
      if (response.backupCodes) setResult(response);
      else onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyPasskey = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await authenticateCustomerPasskey();
      onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = setup
        ? await api.finishTwoFactorSetup(method, code)
        : await api.verifyTwoFactor(backupMode ? { backupCode } : { code });
      if (response.backupCodes) setResult(response);
      else onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setCode("");
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const continueWithBackupCodes = async () => {
    setBusy(true);
    setError("");
    try {
      onComplete(await completeTwoFactorSession(result.customToken));
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy(false);
    }
  };

  if (status.locked) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Account locked</p>
        <h2>Account security is locked</h2>
        <p>Three consecutive verification attempts failed. An owner must unlock this account from Users & Roles.</p>
        <button className="btn btn-outline-danger" onClick={() => resetPassword(user.email).then(() => window.alert("Password reset email sent. After changing the password, sign in again to unlock security.")).catch((requestError) => window.alert(requestError.message))}>Reset password to unlock</button>
        <button className="btn btn-link text-danger" onClick={logout}>Return to sign in</button>
      </div></div>
    );
  }

  if (result?.backupCodes) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Recovery codes</p>
        <h2>Save these backup codes</h2>
        <p>Each code works once. They cannot be displayed again after you continue.</p>
        <div className="backup-code-grid">{result.backupCodes.map((item) => <code key={item}>{item}</code>)}</div>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <button className="btn btn-danger w-100" disabled={busy} onClick={continueWithBackupCodes}>
          {busy ? "Opening your dashboard..." : "I saved my codes, continue"}
        </button>
      </div></div>
    );
  }

  return (
    <div className="security-screen">
      <form className="security-card" onSubmit={verify}>
        <p className="eyebrow text-danger">{setup ? "Required security setup" : "Second verification step"}</p>
        <h2>{setup ? "Set up account security" : "Verify your sign-in"}</h2>
        <p>{setup
          ? customerAccount
            ? "Choose passkey, email, a security app, or SMS. Passkey is the fastest option on phones with fingerprint, Face ID, or screen lock."
            : "Owner, staff, and rider accounts must use a security app before opening POS tools."
          : status.method === "passkey"
            ? "Confirm with your phone fingerprint, Face ID, or screen lock to finish signing in."
            : `Enter the code from your ${status.method === "sms" ? "phone" : status.method === "email" ? "verified email" : "security app"}.`}</p>
        {setup && (
          <div className="security-methods">
            {customerAccount && (
              <>
                <button type="button" disabled={!status.passkeyAvailable || !browserPasskeysReady} className={method === "passkey" ? "active" : ""} onClick={() => { setMethod("passkey"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>Passkey</strong><small>{browserPasskeysReady ? "Fingerprint, Face ID, or screen lock" : "Needs HTTPS or localhost"}</small>
                </button>
                <button type="button" disabled={!status.emailOtpAvailable} className={method === "email" ? "active" : ""} onClick={() => { setMethod("email"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>Email code</strong><small>{status.emailOtpAvailable ? `Send to ${status.emailMasked}` : "Email sending is not ready"}</small>
                </button>
                <button type="button" disabled={!status.smsAvailable} className={method === "sms" ? "active" : ""} onClick={() => { setMethod("sms"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>SMS code</strong><small>{status.smsAvailable ? `Send to ${status.phoneMasked}` : "Phone number required"}</small>
                </button>
              </>
            )}
            <button type="button" className={method === "totp" ? "active" : ""} onClick={() => { setMethod("totp"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
              <strong>Security app</strong><small>Free, offline 30-second codes</small>
            </button>
          </div>
        )}
        {method === "passkey" && !backupMode && (
          <div className="passkey-panel">
            <strong>{setup ? "Create customer passkey" : "Use customer passkey"}</strong>
            <span>{browserPasskeysReady ? "Your phone will ask for fingerprint, Face ID, PIN, or screen lock." : "Passkeys need HTTPS or localhost. Use this after deployment, or test on localhost."}</span>
            <button type="button" className="btn btn-danger w-100" disabled={busy || !browserPasskeysReady} onClick={setup ? setupPasskey : verifyPasskey}>
              {busy ? "Waiting for passkey..." : setup ? "Create passkey" : "Continue with passkey"}
            </button>
          </div>
        )}
        {setup && method === "totp" && !setupData && <button type="button" className="btn btn-outline-danger w-100" disabled={busy || !status.totpAvailable} onClick={beginTotp}>Show security app setup code</button>}
        {setupData && method === "totp" && <div className="totp-setup"><img src={setupData.qrDataUrl} alt="Security app setup code" /><p>Setup key: <code>{setupData.manualKey}</code></p></div>}
        {method === "sms" && !backupMode && <button type="button" className="btn btn-outline-danger w-100 mb-3" disabled={busy || !status.smsAvailable} onClick={sendSms}>Send 6-digit SMS code</button>}
        {method === "email" && !backupMode && <button type="button" className="btn btn-outline-danger w-100 mb-3" disabled={busy || !status.emailOtpAvailable} onClick={sendEmail}>Send 6-digit email code</button>}
        {!backupMode && method !== "passkey" ? (
          <>
            <label className="form-label">6-digit verification code</label>
            <OtpInput value={code} onChange={setCode} disabled={busy} />
          </>
        ) : (
          <label className="form-label">Single-use backup code<input className="form-control" autoComplete="one-time-code" value={backupCode} onChange={(event) => setBackupCode(event.target.value.toUpperCase())} /></label>
        )}
        {deliveryMessage && <div className="alert alert-success py-2 small mt-3">{deliveryMessage}</div>}
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        {(method !== "passkey" || backupMode) && <button className="btn btn-danger w-100 mt-3" disabled={busy || (!backupMode && code.length !== 6) || (backupMode && backupCode.length < 8)}>
          {busy ? "Verifying..." : setup ? "Save security setup" : "Verify and open POS"}
        </button>}
        {!setup && <button type="button" className="btn btn-link text-danger w-100" onClick={() => setBackupMode((current) => !current)}>{backupMode ? "Use verification code" : "Use backup code"}</button>}
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </form>
    </div>
  );
}

export { EmailVerificationPanel, LoginPanel, TwoFactorPanel };
