import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Clock, CreditCard, Eye, EyeOff, MapPin, ShieldCheck, Star, Store, Truck, X } from "lucide-react";
import { BrandMark } from "../../components/Branding";
import { formatStoreHoursLabel, getWebsiteOpenStatus, paymentMethodLabels, serviceAvailabilityLabels, websiteStoreConfig } from "../../config/appConfig";
import { demoAccounts, fallbackMenu } from "../../data/menu";
import { api } from "../../services/api";
import {
  trackLandingMenuView,
  trackLandingOrderEntry,
  trackLogin,
  trackRegistrationComplete,
  trackRegistrationStart
} from "../../services/analytics";
import {
  completeTwoFactorSession,
  friendlyAuthError,
  login,
  logout,
  refreshEmailVerification,
  registerCustomer,
  resendVerificationEmail,
  resetPassword
} from "../../services/firebase/auth";
import { demoModeEnabled, firebaseEnabled } from "../../services/firebase/core";
import { subscribePublicReviews } from "../../services/firebase/feedback";
import { subscribeMenu } from "../../services/firebase/menu";
import { authenticateCustomerPasskey, passkeysSupported, registerCustomerPasskey } from "../../services/passkeys";
import { currency } from "../../utils/display";
import { menuAvailability } from "../../utils/operations";
import { normalizeFullName, passwordChecklist, validateCustomerRegistrationForm } from "../../utils/registrationValidation";

const loginRoleOptions = [
  { id: "customer", label: "Customer", detail: "Order meals" },
  { id: "owner", label: "Owner", detail: "Run the store" },
  { id: "staff", label: "Staff", detail: "Serve orders" },
  { id: "rider", label: "Rider", detail: "Deliver food" }
];

const popularMealPriority = ["porkchop-meal", "tapa-meal", "sisig-meal", "chicken-wings-meal", "boneless-chicken-meal", "lechon-kawali-meal"];
const popularMealDetails = {
  "porkchop-meal": "Crispy porkchop served as a filling TapTap rice meal.",
  "tapa-meal": "A familiar tapsilog favorite for any time of day.",
  "sisig-meal": "Savory house-style sisig paired with a complete rice meal.",
  "chicken-wings-meal": "Golden chicken wings with rice and a satisfying Pinoy bite.",
  "boneless-chicken-meal": "Easy-to-eat boneless chicken for pickup or delivery.",
  "lechon-kawali-meal": "Crisp lechon kawali for a hearty Filipino foodtrip."
};

const getPopularMeals = (menu = []) => {
  const priority = new Map(popularMealPriority.map((id, index) => [id, index]));
  const selectMeals = (items) => items
    .filter((item) => item.image && !item.walkInOnly && Number(item.stock ?? 1) > 0 && menuAvailability(item).available)
    .filter((item) => item.featured || item.category === "Favorite Meal")
    .sort((first, second) => (priority.get(first.id) ?? 99) - (priority.get(second.id) ?? 99));
  const selected = selectMeals(menu);
  return (selected.length ? selected : selectMeals(fallbackMenu)).slice(0, 4).map((item) => ({
    ...item,
    detail: popularMealDetails[item.id] || item.description,
    availabilityLabel: menuAvailability(item).label
  }));
};

const getStartingMealPrice = (menu = []) => {
  const prices = menu
    .filter((item) => item.category === "Favorite Meal" && !item.walkInOnly && !item.unavailable)
    .map((item) => Number(item.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : 69;
};

const orderSteps = [
  { tag: "Choose", title: "Pick your meal", detail: "Browse current favorites, prices, and availability." },
  { tag: "Handoff", title: "Select delivery or pickup", detail: "Add your contact and drop-off details only when needed." },
  { tag: "Confirm", title: "Place and track your order", detail: "Review the total, choose payment, and follow order updates." }
];

const serviceModes = [
  { id: "delivery", icon: Truck, title: "Delivery", detail: "Use an exact drop-off pin and landmark." },
  { id: "pickup", icon: Store, title: "Pickup", detail: "Order ahead and collect at the counter." },
  { id: "walk-in", icon: MapPin, title: "Walk-in", detail: "Dine in or order takeout at the store." }
];

const landingCategoryOrder = ["Favorite Meal", "Alacarte", "Solo", "Special Meal", "Drinks"];
const landingCategoryLabels = {
  all: "All",
  "Favorite Meal": "Rice meals",
  Alacarte: "A la carte",
  Solo: "Solo",
  "Special Meal": "Specials",
  Drinks: "Drinks"
};

const getLandingMenuCategories = (menu = []) => landingCategoryOrder.filter((category) => (
  menu.some((item) => item.category === category && item.image && !item.walkInOnly)
));

const getLandingMenuItems = (menu = [], category = "all") => menu
  .filter((item) => item.image && !item.walkInOnly && (category === "all" || item.category === category))
  .sort((first, second) => {
    if (Boolean(first.featured) !== Boolean(second.featured)) return first.featured ? -1 : 1;
    const categoryDifference = landingCategoryOrder.indexOf(first.category) - landingCategoryOrder.indexOf(second.category);
    return categoryDifference || String(first.name).localeCompare(String(second.name));
  });

const isMenuItemOrderable = (item) => menuAvailability(item).available && !item.unavailable && Number(item.stock ?? 1) > 0;

const formatPrepTime = ({ min, max }) => `${min}-${max} min`;
const availableServices = () => Object.entries(websiteStoreConfig.serviceAvailability)
  .filter(([, enabled]) => enabled)
  .map(([service]) => serviceAvailabilityLabels[service] || service);
const availableServiceLabel = () => availableServices().join(" / ");
const availableServiceSentence = () => {
  const services = availableServices().map((service) => service.toLowerCase());
  if (services.length < 2) return services[0] || "current service options";
  if (services.length === 2) return services.join(" or ");
  return `${services.slice(0, -1).join(", ")}, or ${services[services.length - 1]}`;
};
const paymentLabel = () => websiteStoreConfig.paymentMethods
  .map((method) => paymentMethodLabels[method] || method.toUpperCase())
  .join(" / ");
const getOrderingDetails = () => [
  { icon: Store, label: "Prep time", value: formatPrepTime(websiteStoreConfig.prepTimeMinutes), detail: "After order confirmation" },
  { icon: Truck, label: "Order options", value: availableServiceLabel(), detail: "Choose before checkout" },
  { icon: CreditCard, label: "Payments", value: paymentLabel(), detail: "Shown before confirmation" },
  { icon: MapPin, label: "Delivery area", value: websiteStoreConfig.serviceAreaLabel, detail: websiteStoreConfig.serviceAreaDetail }
];

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
let turnstileScriptPromise;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error("Security check could not load. Refresh the page or check your connection."));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

function TurnstileWidget({ siteKey, resetKey, onToken, onError }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;
    let cancelled = false;
    setStatus("loading");

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || !containerRef.current) return;
        if (widgetIdRef.current) {
          try {
            turnstile.remove(widgetIdRef.current);
          } catch {
            // The widget may already be removed by Cloudflare during fast remounts.
          }
          widgetIdRef.current = null;
        }
        containerRef.current.replaceChildren();
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: "customer_registration",
          theme: "light",
          callback(token) {
            setStatus("verified");
            onToken(token);
          },
          "expired-callback"() {
            setStatus("expired");
            onToken("");
            onError("Security check expired. Please complete it again.");
          },
          "error-callback"() {
            setStatus("error");
            onToken("");
            onError("Security check could not be completed. Refresh the page or check your connection.");
          }
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          onError("Security check could not load. Refresh the page or check your connection.");
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The widget may already be removed by Cloudflare during route cleanup.
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, resetKey, onToken, onError]);

  return (
    <div className="registration-turnstile-widget">
      <div ref={containerRef} />
      {status === "loading" && <small>Loading security check...</small>}
      {status === "expired" && <small>Security check expired. Please complete it again.</small>}
      {status === "error" && <small>Security check could not be completed. Refresh the page or check your connection.</small>}
    </div>
  );
}

function LoginPanel({ onLoggedIn }) {
  const registrationRequested = new URLSearchParams(window.location.search).get("register") === "true";
  const registrationStepDefaults = [
    { id: "auth", label: "Account created", detail: "Waiting to create your secure login.", status: "pending" },
    { id: "profile", label: "Customer profile", detail: "Waiting to save your profile.", status: "pending" },
    { id: "verification", label: "Verification email", detail: "Waiting to request your verification email.", status: "pending" },
    { id: "session", label: "Security setup", detail: "Required after your first sign in.", status: "pending" }
  ];
  const [role, setRole] = useState("customer");
  const [registering, setRegistering] = useState(registrationRequested);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(registrationRequested || !demoModeEnabled ? "" : demoAccounts.customer.email);
  const [password, setPassword] = useState(registrationRequested || !demoModeEnabled ? "" : demoAccounts.customer.password);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [botField, setBotField] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileMessage, setTurnstileMessage] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [registrationSteps, setRegistrationSteps] = useState(registrationStepDefaults);
  const [registrationResult, setRegistrationResult] = useState(null);
  const [loginModalOpen, setLoginModalOpen] = useState(registrationRequested);
  const [teamAccessOpen, setTeamAccessOpen] = useState(false);
  const [openStatus, setOpenStatus] = useState(() => getWebsiteOpenStatus());
  const [landingMenu, setLandingMenu] = useState(fallbackMenu);
  const [activeMenuCategory, setActiveMenuCategory] = useState("all");
  const [showFullMenu, setShowFullMenu] = useState(false);
  const [publicReviews, setPublicReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [showMobileOrderCta, setShowMobileOrderCta] = useState(false);
  const loginHomeRef = useRef(null);
  const loginModalRef = useRef(null);
  const lastFocusedElementRef = useRef(null);

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

  useEffect(() => {
    const refreshStatus = () => setOpenStatus(getWebsiteOpenStatus());
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    if (!targetId || targetId === "home") return undefined;

    const scrollToTarget = () => document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    const frame = window.requestAnimationFrame(scrollToTarget);
    const retry = window.setTimeout(scrollToTarget, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, []);

  useEffect(() => subscribeMenu(fallbackMenu, setLandingMenu), []);

  useEffect(() => {
    const heroActions = loginHomeRef.current?.querySelector(".login-hero-actions");
    if (!heroActions || !window.IntersectionObserver) return undefined;
    const observer = new IntersectionObserver(([entry]) => setShowMobileOrderCta(!entry.isIntersecting), {
      rootMargin: "-72px 0px 0px"
    });
    observer.observe(heroActions);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const loadingFallback = window.setTimeout(() => {
      if (!active) return;
      setPublicReviews([]);
      setReviewsLoading(false);
    }, 4000);
    const unsubscribe = subscribePublicReviews((reviews) => {
      if (!active) return;
      window.clearTimeout(loadingFallback);
      const visibleReviews = reviews.map((review) => ({
        id: review.id,
        orderId: review.orderId,
        name: review.customerLabel || "TapTap customer",
        rating: Number(review.rating || 0),
        quote: review.comment
      }));
      setPublicReviews(visibleReviews);
      setReviewsLoading(false);
    });
    return () => {
      active = false;
      window.clearTimeout(loadingFallback);
      unsubscribe?.();
    };
  }, []);

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
      if (next) trackRegistrationStart(demoModeEnabled ? "demo" : "firebase");
      return next;
    });
    setRole("customer");
    setTeamAccessOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    setBotField("");
    setTurnstileToken("");
    setTurnstileMessage("");
    setTurnstileResetKey((current) => current + 1);
    setFieldErrors({});
    setError("");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const selectRole = (nextRole) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("register");
    window.history.replaceState({}, "", url);
    setRole(nextRole);
    setEmail(demoModeEnabled ? demoAccounts[nextRole].email : "");
    setPassword(demoModeEnabled ? demoAccounts[nextRole].password : "");
    setConfirmPassword("");
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    setBotField("");
    setTurnstileToken("");
    setTurnstileMessage("");
    setTurnstileResetKey((current) => current + 1);
    setFieldErrors({});
    setRegistering(false);
    setTeamAccessOpen(nextRole !== "customer");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const openLoginModal = (preferredRole, source = "landing") => {
    trackLandingOrderEntry(source, preferredRole || role);
    lastFocusedElementRef.current = document.activeElement;
    if (preferredRole && !registering) selectRole(preferredRole);
    if (!preferredRole && role === "customer") setTeamAccessOpen(false);
    setLoginModalOpen(true);
  };

  const trackMenuView = (source) => {
    trackLandingMenuView(source);
  };

  const closeLoginModal = () => {
    setLoginModalOpen(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFieldErrors({});
    setTurnstileMessage("");
    if (registering) {
      setRegistrationResult(null);
      setRegistrationSteps(registrationStepDefaults);
    }
    try {
      if (registering) {
        const validation = validateCustomerRegistrationForm({
          name,
          email,
          password,
          confirmPassword,
          termsAccepted,
          privacyAccepted,
          botField,
          turnstileRequired: Boolean(turnstileSiteKey),
          turnstileToken
        });
        if (!validation.valid) {
          setFieldErrors(validation.errors);
          throw new Error(validation.errors.form || "Check the highlighted registration details.");
        }
        const result = await registerCustomer(validation.values, updateRegistrationStep);
        setRegistrationResult(result);
        trackRegistrationComplete(demoModeEnabled ? "demo" : "firebase");
        setPassword("");
        setConfirmPassword("");
        setTurnstileToken("");
        setTurnstileResetKey((current) => current + 1);
      } else {
        await login(email, password, role, demoAccounts);
        trackLogin(demoModeEnabled ? "demo" : "firebase", role);
        onLoggedIn?.();
      }
    } catch (authError) {
      if (registering && turnstileSiteKey) {
        setTurnstileToken("");
        setTurnstileResetKey((current) => current + 1);
      }
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = busy
    ? registering ? "Creating your account..." : "Signing in..."
    : registering ? "Create account" : role === "customer" ? "Sign in and order" : `Sign in as ${role}`;
  const passwordItems = passwordChecklist(password);
  const orderingDetails = getOrderingDetails();
  const popularMeals = getPopularMeals(landingMenu);
  const menuCategories = getLandingMenuCategories(landingMenu);
  const filteredMenuItems = getLandingMenuItems(landingMenu, activeMenuCategory);
  const visibleMenuItems = showFullMenu ? filteredMenuItems : filteredMenuItems.slice(0, 8);
  const reviewAverage = publicReviews.length
    ? (publicReviews.reduce((total, review) => total + review.rating, 0) / publicReviews.length).toFixed(1)
    : null;
  const startingPriceLabel = currency(getStartingMealPrice(landingMenu));
  const faqItems = [
    { question: "When can I order?", answer: `Today's configured hours are ${openStatus.todayHoursLabel}. The status above refreshes automatically in ${websiteStoreConfig.timezone}.` },
    { question: "How long does preparation take?", answer: `Most confirmed orders need about ${formatPrepTime(websiteStoreConfig.prepTimeMinutes)} before pickup or handoff.` },
    { question: "Which order options are available?", answer: `${availableServiceLabel()} are currently configured. Delivery orders need an exact pin and a useful landmark.` },
    { question: "How can I pay?", answer: `${paymentLabel()} are the customer payment options currently shown before confirmation.` },
    { question: "Can I track or cancel an order?", answer: "Signed-in customers can follow status updates. Eligible orders can be cancelled while they are still pending or newly received." }
  ];

  const loginCard = (
    <form className="login-card" onSubmit={submit} data-login-modal-panel>
      <div className="login-card-header">
        <div className="brand-lockup"><BrandMark /><div><strong>TapTap</strong><small>FOODTRIP</small></div></div>
        <span>{registering ? "Customer signup" : loginRoleOptions.find((item) => item.id === role)?.label}</span>
      </div>
      <p className="eyebrow text-danger">TapTap account</p>
      <h2>{registering ? "Create customer account" : "Welcome back"}</h2>
      <p className="login-card-copy">{firebaseEnabled ? "Sign in to continue your foodtrip." : demoModeEnabled ? "Sample accounts are ready for this preview." : "Connect Firebase to sign in."}</p>
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
          <input
            aria-describedby={fieldErrors.name ? "registration-name-error" : undefined}
            aria-invalid={Boolean(fieldErrors.name)}
            autoComplete="name"
            className={`form-control ${fieldErrors.name ? "is-invalid" : ""}`}
            required
            value={name}
            onBlur={() => setName(normalizeFullName(name))}
            onChange={(event) => setName(event.target.value)}
          />
          {fieldErrors.name && <small className="registration-field-error" id="registration-name-error">{fieldErrors.name}</small>}
        </label>
      )}
      <label className="form-label">Email
        <input
          aria-describedby={fieldErrors.email ? "registration-email-error" : undefined}
          aria-invalid={Boolean(fieldErrors.email)}
          autoComplete={registering ? "email" : "username"}
          className={`form-control ${fieldErrors.email ? "is-invalid" : ""}`}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldErrors.email && <small className="registration-field-error" id="registration-email-error">{fieldErrors.email}</small>}
      </label>
      <label className="form-label">Password
        <span className="login-password-field">
          <input
            aria-describedby={fieldErrors.password ? "registration-password-error" : undefined}
            aria-invalid={Boolean(fieldErrors.password)}
            autoComplete={registering ? "new-password" : "current-password"}
            className={`form-control ${fieldErrors.password ? "is-invalid" : ""}`}
            type={showPassword ? "text" : "password"}
            minLength={registering ? 12 : 8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </span>
        {fieldErrors.password && <small className="registration-field-error" id="registration-password-error">{fieldErrors.password}</small>}
      </label>
      {registering && (
        <>
          <label className="form-label">Confirm password
            <input
              aria-describedby={fieldErrors.confirmPassword ? "registration-confirm-password-error" : undefined}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              autoComplete="new-password"
              className={`form-control ${fieldErrors.confirmPassword ? "is-invalid" : ""}`}
              type={showPassword ? "text" : "password"}
              minLength="12"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {fieldErrors.confirmPassword && <small className="registration-field-error" id="registration-confirm-password-error">{fieldErrors.confirmPassword}</small>}
          </label>
          <div className="registration-password-rules" aria-label="Password requirements">
            {passwordItems.map((item) => (
              <span className={item.valid ? "valid" : ""} key={item.id}>{item.label}</span>
            ))}
          </div>
          <div className="registration-consent-panel">
            <label className={`registration-checkbox ${fieldErrors.termsAccepted ? "invalid" : ""}`}>
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span><strong>I agree to the Terms</strong><small>I will use TapTap Foodtrip ordering responsibly.</small></span>
            </label>
            <label className={`registration-checkbox ${fieldErrors.privacyAccepted ? "invalid" : ""}`}>
              <input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} />
              <span><strong>I agree to the Privacy Notice</strong><small>TapTap may save my account, contact, order, and delivery details for service use.</small></span>
            </label>
            {(fieldErrors.termsAccepted || fieldErrors.privacyAccepted) && (
              <small className="registration-field-error">Accept both items before creating an account.</small>
            )}
          </div>
          <label className="registration-honeypot" aria-hidden="true">
            Company
            <input tabIndex="-1" autoComplete="off" value={botField} onChange={(event) => setBotField(event.target.value)} />
          </label>
          {turnstileSiteKey && (
            <div className={`registration-turnstile-panel ${fieldErrors.turnstileToken ? "invalid" : ""}`}>
              <div className="registration-turnstile-heading">
                <strong>Security check</strong>
                <small>Confirms this signup is made by a real customer.</small>
              </div>
              <TurnstileWidget
                siteKey={turnstileSiteKey}
                resetKey={turnstileResetKey}
                onToken={setTurnstileToken}
                onError={setTurnstileMessage}
              />
              {(fieldErrors.turnstileToken || turnstileMessage) && (
                <small className="registration-field-error">{fieldErrors.turnstileToken || turnstileMessage}</small>
              )}
            </div>
          )}
        </>
      )}
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
              <div>
                <strong>Customer account created</strong>
                <span>Your TapTap account is ready. Verify your email before ordering.</span>
              </div>
              <ul>
                <li><b>Account created</b><span>Your customer profile was saved.</span></li>
                <li><b>Email verification required</b><span>{registrationResult.verificationSent ? "A verification email was sent." : "Sign in later to resend the verification email."}</span></li>
                <li><b>Security setup required</b><span>After sign in, choose passkey, email code, or security app.</span></li>
              </ul>
              <div className="registration-result-actions">
                <a className="btn btn-outline-danger btn-sm" href="https://mail.google.com/" target="_blank" rel="noreferrer">Open Gmail</a>
                <button type="button" className="btn btn-danger btn-sm" onClick={toggleRegistration}>Back to sign in</button>
              </div>
              {!registrationResult.verificationSent && <small>Use Resend verification after signing in if the email did not arrive.</small>}
            </div>
          )}
        </div>
      )}
      {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}
      <button className="btn btn-danger w-100 login-submit-button" disabled={busy || Boolean(registering && registrationResult)}>
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
      <a className="login-skip-link" href="#popular-meals" onClick={() => trackMenuView("skip_link")}>Skip to menu</a>
      <header className="login-home-header" data-login-nav>
        <a className="brand-lockup login-home-brand" href="#home" aria-label="TapTap Foodtrip home">
          <BrandMark />
          <div><strong>TapTap</strong><small>FOODTRIP</small></div>
        </a>
        <nav className="login-home-nav" aria-label="Homepage sections">
          <a href="#popular-meals" onClick={() => trackMenuView("nav_favorites")}>Favorites</a>
          <a href="#browse-menu" onClick={() => trackMenuView("nav_menu")}>Menu</a>
          <a href="#how-ordering-works">How it works</a>
          <a href="#customer-reviews">Reviews</a>
        </nav>
        <div className="login-header-actions">
          <button type="button" className="btn btn-danger login-nav-cta" onClick={() => openLoginModal("customer", "nav_order")}>
            Order now <ArrowRight aria-hidden="true" size={16} strokeWidth={2.6} />
          </button>
        </div>
      </header>

      <section className="login-screen" id="home" aria-label="TapTap Foodtrip homepage">
        <div className="login-visual">
          <div className="login-status-line" data-login-hero aria-live="polite">
            <span className={`login-open-chip ${openStatus.open ? "is-open" : "is-closed"}`}>
              <i aria-hidden="true" /> {openStatus.label}
            </span>
            <span className="login-status-detail">{openStatus.detail}</span>
          </div>
          <div className="login-restaurant-copy">
            <p className="eyebrow" data-login-hero>Pinoy comfort food, made for your day</p>
            <h1 data-login-hero>TapTap Foodtrip <span>rice meals</span></h1>
            <p className="login-hero-copy" data-login-hero>
              <span>Pinoy favorites from {startingPriceLabel}.</span>
              <span>Available for {availableServiceSentence()}.</span>
            </p>
            <div className="login-hero-actions" data-login-hero>
              <button type="button" className="btn btn-warning" onClick={() => openLoginModal("customer", "hero_order")}>
                Order now <ArrowRight aria-hidden="true" size={17} strokeWidth={2.6} />
              </button>
              <a className="login-menu-link" href="#popular-meals" onClick={() => trackMenuView("hero_menu")}>
                View menu <ArrowRight aria-hidden="true" size={16} strokeWidth={2.4} />
              </a>
            </div>
          </div>
          <div className="login-hero-promise" data-login-hero>
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={2.3} />
            <div><strong>{websiteStoreConfig.customerPromise.label}</strong><small>{websiteStoreConfig.customerPromise.detail}</small></div>
          </div>
        </div>
      </section>

      <section className="login-trust-strip" aria-label="Store and ordering details">
        <div>
          {orderingDetails.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.label}>
                <Icon aria-hidden="true" size={20} strokeWidth={2.3} />
                <div><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="login-business-section login-menu-section" id="popular-meals" data-login-section>
        <div className="login-section-heading login-section-heading-split" data-login-reveal>
          <div>
            <p className="eyebrow text-danger">Popular meals</p>
            <h2>Start with a TapTap favorite.</h2>
          </div>
          <div className="login-section-sidecopy">
            <p>Prices and availability come directly from the current customer menu.</p>
            <a href="#browse-menu" onClick={() => trackMenuView("popular_full_menu")}>Browse the full menu <ArrowRight aria-hidden="true" size={15} /></a>
          </div>
        </div>
        <div className="login-meal-showcase">
          {popularMeals.map((meal) => (
            <article className="login-meal-card" key={meal.id} data-login-reveal>
              <img src={meal.image} alt={`${meal.name} rice meal`} loading="lazy" width={360} height={270} decoding="async" sizes="(max-width: 620px) 112px, (max-width: 1100px) 45vw, 280px" />
              <div>
                <span className="login-meal-tag">{meal.availabilityLabel}</span>
                <strong>{meal.name}</strong>
                <p>{meal.detail}</p>
                <div className="login-meal-card-actions">
                  <span className="login-price-pill">{currency(meal.price)}</span>
                  <button type="button" className="btn btn-outline-danger btn-sm" aria-label={`Sign in to order ${meal.name}`} onClick={() => openLoginModal("customer", "popular_meal")}>
                    Sign in to order <ArrowRight aria-hidden="true" size={15} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-menu-browser" id="browse-menu" data-login-section>
        <div className="login-section-heading login-section-heading-split" data-login-reveal>
          <div>
            <p className="eyebrow text-danger">Current menu</p>
            <h2>Browse before you sign in.</h2>
          </div>
          <p>Filter the live menu, check what is available, then sign in when you are ready to order.</p>
        </div>
        <div className="login-menu-categories" role="group" aria-label="Filter menu by category" data-login-reveal>
          {["all", ...menuCategories].map((category) => (
            <button
              type="button"
              key={category}
              className={activeMenuCategory === category ? "active" : ""}
              aria-pressed={activeMenuCategory === category}
              onClick={() => {
                setActiveMenuCategory(category);
                setShowFullMenu(false);
              }}
            >
              {landingCategoryLabels[category] || category}
            </button>
          ))}
        </div>
        <div className="login-menu-browser-grid">
          {visibleMenuItems.map((meal) => {
            const availability = menuAvailability(meal);
            const orderable = isMenuItemOrderable(meal);
            return (
              <article className="login-menu-browser-card" key={meal.id} data-login-reveal>
                <img src={meal.image} alt={meal.name} loading="lazy" width={320} height={240} decoding="async" sizes="(max-width: 620px) 96px, (max-width: 1000px) 42vw, 260px" />
                <div>
                  <span className={`login-meal-tag ${orderable ? "is-available" : "is-unavailable"}`}>
                    {orderable ? availability.label : "Unavailable"}
                  </span>
                  <strong>{meal.name}</strong>
                  <small>{landingCategoryLabels[meal.category] || meal.category}</small>
                  <div className="login-menu-browser-actions">
                    <b>{currency(meal.price)}</b>
                    <button type="button" className="btn btn-outline-danger btn-sm" disabled={!orderable} onClick={() => openLoginModal("customer", "menu_item")}>
                      {orderable ? "Sign in to order" : "Unavailable"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {filteredMenuItems.length > 8 && (
          <button type="button" className="login-menu-expand" aria-expanded={showFullMenu} onClick={() => setShowFullMenu((current) => !current)}>
            {showFullMenu ? "Show fewer meals" : `View full ${landingCategoryLabels[activeMenuCategory] || "menu"}`}
            <ChevronDown aria-hidden="true" size={17} />
          </button>
        )}
      </section>

      <section className="login-business-section login-service-section" id="service-options" data-login-section>
        <div className="login-section-heading login-section-heading-split" data-login-reveal>
          <div>
            <p className="eyebrow text-danger">Order your way</p>
            <h2>Choose the handoff that fits your day.</h2>
          </div>
          <p>Ordering details stay simple and use the same checkout flow already connected to your account.</p>
        </div>
        <div className="login-service-layout">
          <div className="login-service-choice-list">
            {serviceModes.filter((item) => websiteStoreConfig.serviceAvailability[item.id]).map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.id} data-login-reveal>
                  <Icon aria-hidden="true" size={21} strokeWidth={2.3} />
                  <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                </article>
              );
            })}
          </div>
          <aside className="login-coverage-note" data-login-reveal aria-label="Delivery coverage note">
            <MapPin aria-hidden="true" size={22} strokeWidth={2.3} />
            <div>
              <span>Delivery coverage</span>
              <strong>{websiteStoreConfig.serviceAreaLabel}</strong>
              <p>{websiteStoreConfig.serviceAreaDetail}</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="login-business-section login-order-flow-section" id="how-ordering-works" data-login-section>
        <div className="login-section-heading compact" data-login-reveal>
          <p className="eyebrow text-danger">How ordering works</p>
          <h2>From craving to confirmation in three steps.</h2>
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

      <section className={`login-business-section login-review-section ${!reviewsLoading && publicReviews.length === 0 ? "is-empty" : ""}`} id="customer-reviews" data-login-section>
        <div className="login-section-heading compact" data-login-reveal>
          <p className="eyebrow text-danger">Approved customer reviews</p>
          <h2>Feedback shared after real TapTap orders.</h2>
          <p>{reviewAverage ? `${reviewAverage} average from ${publicReviews.length} approved public ${publicReviews.length === 1 ? "review" : "reviews"}.` : "Only approved customer feedback appears here."}</p>
        </div>
        <div className="login-review-grid" aria-live="polite">
          {reviewsLoading && (
            <p className="login-review-state" data-login-reveal>Loading approved customer feedback...</p>
          )}
          {!reviewsLoading && publicReviews.length === 0 && (
            <p className="login-review-state" data-login-reveal>Approved customer feedback will appear here when available.</p>
          )}
          {!reviewsLoading && publicReviews.slice(0, 3).map((review, index) => (
            <article key={review.id || `${review.name}-${index}`} data-login-reveal>
              <div className="login-review-rating" aria-label={`${review.rating.toFixed(1)} out of 5 rating`}>
                <Star aria-hidden="true" size={16} fill="currentColor" strokeWidth={2.4} />
                <strong>{review.rating.toFixed(1)}</strong>
              </div>
              <p>{review.quote}</p>
              <span>{review.name}{review.orderId && <small><ShieldCheck aria-hidden="true" size={14} /> Verified order</small>}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="login-business-section login-location-section" id="location-hours" data-login-section>
        <div className="login-section-heading login-section-heading-split" data-login-reveal>
          <div>
            <p className="eyebrow text-danger">Coverage and hours</p>
            <h2>Plan the handoff before checkout.</h2>
          </div>
          <p>These details come from the same typed store configuration used by the live status above.</p>
        </div>
        <div className="login-location-layout">
          <article data-login-reveal>
            <MapPin aria-hidden="true" size={22} strokeWidth={2.3} />
            <div>
              <span>Service area</span>
              <strong>{websiteStoreConfig.serviceAreaLabel}</strong>
              <p>{websiteStoreConfig.serviceAreaDetail}</p>
            </div>
          </article>
          <article className="login-hours-panel" data-login-reveal>
            <Clock aria-hidden="true" size={22} strokeWidth={2.3} />
            <div>
              <span>Weekly store hours</span>
              <dl>
                {websiteStoreConfig.hours.map((hours) => (
                  <div key={hours.day}><dt>{hours.label}</dt><dd>{formatStoreHoursLabel(hours)}</dd></div>
                ))}
              </dl>
            </div>
          </article>
        </div>
      </section>

      <section className="login-business-section login-faq-section" id="frequently-asked" data-login-section>
        <div className="login-section-heading compact" data-login-reveal>
          <p className="eyebrow text-danger">Before you order</p>
          <h2>Quick answers to common questions.</h2>
        </div>
        <div className="login-faq-list">
          {faqItems.map((item) => (
            <details key={item.question} data-login-reveal>
              <summary>{item.question}<ChevronDown aria-hidden="true" size={18} /></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="login-final-cta" data-login-section>
        <div>
          <p className="eyebrow">Ready for your next meal?</p>
          <h2>Choose a favorite and start your foodtrip.</h2>
          <p>Browse first, confirm the total, and track the order from one customer account.</p>
        </div>
        <button type="button" className="btn btn-warning login-bottom-cta" onClick={() => openLoginModal("customer", "final_order")}>
          Order now <ArrowRight aria-hidden="true" size={17} strokeWidth={2.6} />
        </button>
      </section>

      <footer className="login-home-footer">
        <div className="login-footer-main">
          <div className="login-footer-brand">
            <div className="brand-lockup"><BrandMark /><div><strong>TapTap</strong><small>FOODTRIP</small></div></div>
            <p>{websiteStoreConfig.customerPromise.detail}</p>
          </div>
          <div className="login-footer-facts">
            <div><Clock aria-hidden="true" size={18} /><span><strong>{openStatus.todayHoursLabel}</strong><small>Today's hours</small></span></div>
            <div><Truck aria-hidden="true" size={18} /><span><strong>{availableServiceLabel()}</strong><small>{websiteStoreConfig.serviceAreaLabel}</small></span></div>
            <div><CreditCard aria-hidden="true" size={18} /><span><strong>{paymentLabel()}</strong><small>Payment options</small></span></div>
          </div>
          <div className="login-footer-team">
            <strong>Team access</strong>
            <span>Secure sign-in for store operations.</span>
            <div>
              {loginRoleOptions.filter((item) => item.id !== "customer").map((item) => (
                <button type="button" key={item.id} onClick={() => openLoginModal(item.id, "footer_team")}>{item.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="login-footer-bottom">
          <span>&copy; {new Date().getFullYear()} TapTap Foodtrip</span>
          <button type="button" onClick={() => openLoginModal("customer", "footer_sign_in")}>Customer sign in</button>
        </div>
      </footer>

      <div className={`login-mobile-sticky-cta ${showMobileOrderCta ? "is-visible" : ""}`} aria-label="Quick customer ordering">
        <span>Meals from {startingPriceLabel}</span>
        <button type="button" className="btn btn-warning" onClick={() => openLoginModal("customer", "mobile_sticky_order")}>
          Order now
        </button>
      </div>

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
            <button type="button" className="login-modal-close" aria-label="Close sign in" onClick={closeLoginModal}><X aria-hidden="true" size={20} /></button>
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
  const continueLabel = {
    customer: "Continue to ordering",
    owner: "Open owner dashboard",
    staff: "Open staff workspace",
    rider: "Open rider dashboard"
  }[status.role] || "Continue";
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
        <div className="security-recovery-panel">
          <strong>How to recover access</strong>
          <p>Try a saved backup code if you have one. If this is a customer account, reset your password and sign in again. Team accounts can also ask the owner to unlock or reset security.</p>
        </div>
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
          {busy ? "Verifying..." : setup ? "Save security setup" : continueLabel}
        </button>}
        {!setup && <button type="button" className="btn btn-link text-danger w-100" onClick={() => setBackupMode((current) => !current)}>{backupMode ? "Use verification code" : "Use backup code"}</button>}
        <div className="security-recovery-panel compact">
          <strong>Having trouble?</strong>
          <p>{setup ? "Complete one security method now, then save the backup codes after setup." : "Use a saved backup code, or reset your password if you cannot access your verification method."}</p>
        </div>
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </form>
    </div>
  );
}

export { EmailVerificationPanel, LoginPanel, TwoFactorPanel };
