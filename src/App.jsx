import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import defaultProfilePhoto from "../assets/proflimg.jpg";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Download,
  GraduationCap,
  Eye,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Upload,
  Users,
  Wallet,
  X,
  DoorOpen,
} from "lucide-react";

const api = window.tuition;
const PAGE_SIZE = 8;
const BACKUP_WEEKDAYS = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
];
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const shiftMonth = (month, amount) => {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + amount, 1)).toISOString().slice(0, 7);
};
const monthRange = (from, through) => {
  if (!from || from > through) return [];
  const [year, month] = from.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(
    Number(through.slice(0, 4)),
    Number(through.slice(5, 7)) - 1,
    1,
  );
  const months = [];
  for (
    let date = start;
    date <= end;
    date = Date.UTC(
      new Date(date).getUTCFullYear(),
      new Date(date).getUTCMonth() + 1,
      1,
    )
  ) {
    months.push(new Date(date).toISOString().slice(0, 7));
  }
  return months;
};
const ageFromBirthday = (birthday) => {
  if (!birthday) return null;
  const birth = new Date(`${birthday}T00:00:00`);
  const now = new Date();
  if (Number.isNaN(birth.getTime()) || birth > now) return null;
  return (
    now.getFullYear() -
    birth.getFullYear() -
    (now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
      ? 1
      : 0)
  );
};
const ageOnDate = (birthday, date) => {
  if (!birthday || !date) return null;
  const birth = new Date(`${birthday}T00:00:00`);
  const onDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(onDate.getTime()) || birth > onDate) return null;
  return onDate.getFullYear() - birth.getFullYear()
    - (onDate.getMonth() < birth.getMonth()
      || (onDate.getMonth() === birth.getMonth() && onDate.getDate() < birth.getDate()) ? 1 : 0);
};
const birthdayMessage = (student, date) => {
  if (!student.birthday || !date || student.birthday.slice(5) !== date.slice(5)) return null;
  const age = ageOnDate(student.birthday, date);
  if (age === null) return null;
  const ordinal = age % 100 >= 11 && age % 100 <= 13 ? "th"
    : age % 10 === 1 ? "st"
      : age % 10 === 2 ? "nd"
        : age % 10 === 3 ? "rd" : "th";
  return `Today is ${age}${ordinal} Birthday of ${student.name} !!!`;
};
const money = (amount) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
const CODE39_PATTERNS = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  "*": "nwnnwnwnn",
};
const code39BarcodeWidth = (value) =>
  [...`*${value}*`].reduce(
    (width, character) =>
      width + [...CODE39_PATTERNS[character]].reduce(
        (sum, unit) => sum + (unit === "w" ? 3 : 1),
        0,
      ) + 1,
    -1,
  );
function Code39Barcode({ value, className = "" }) {
  const width = code39BarcodeWidth(value);
  let cursor = 0;
  const bars = [...`*${value}*`].flatMap((character, characterIndex) => {
    const runs = [...CODE39_PATTERNS[character]];
    const elements = runs.map((unit, index) => {
      const runWidth = unit === "w" ? 3 : 1;
      const x = cursor;
      cursor += runWidth;
      return index % 2 === 0
        ? <rect key={`${characterIndex}-${index}`} x={x} y="0" width={runWidth} height="44" />
        : null;
    });
    if (characterIndex < value.length + 1) cursor += 1;
    return elements;
  });
  return (
    <svg
      className={`code39-barcode ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} 44`}
      role="img"
      aria-label={`Code 39 barcode for receipt ${value}`}
      shapeRendering="crispEdges"
    >
      {bars}
    </svg>
  );
}
const roundMoney = (amount) =>
  Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
const prettyDate = (date) =>
  date
    ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const prettyTimestamp = (timestamp) => {
  if (!timestamp) return "—";
  const date = new Date(`${String(timestamp).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};
const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const availabilityLabel = (slots) =>
  slots?.length
    ? slots
        .map(
          (slot) =>
            `${slot.day_of_week.slice(0, 3)} ${slot.start_time}–${slot.end_time}`,
        )
        .join(", ")
    : "No availability set";
const navGroups = [
  {
    label: "Manage",
    items: [
      ["Overview", "overview", LayoutDashboard],
      ["Attendance", "attendance", CheckCheck],
      ["Payments", "payments", CreditCard],
      ["Reports", "reports", Activity],
    ],
  },{
    label: "Workspace",
    items: [
      
      ["Students", "students", Users],
      ["Teachers", "teachers", GraduationCap],
      ["Classes", "classes", BookOpen],
      ["Halls", "halls", DoorOpen],
    ],
  }
  
];

function App() {
  const [user, setUser] = useState(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("overview");
  const [sidebar, setSidebar] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const notify = useCallback((message, kind = "success") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    api.auth
      .status()
      .then((result) => {
        setUser(result.user);
        setSetup(result.needsSetup);
      })
      .catch((error) => notify(error.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (values) => {
    const account = setup
      ? await api.auth.setup(values)
      : await api.auth.login(values);
    setUser(account);
    setSetup(false);
    setPage("overview");
  };

  if (loading)
    return (
      <div className="splash">
        <div className="brand-mark">
          <GraduationCap size={23} />
        </div>
        <span>Loading your workspace…</span>
      </div>
    );
  const recoverAccount = async (values) => {
    const account = await api.auth.recover(values);
    setUser(account);
    setPage("overview");
  };
  const resetDatabase = async () => {
    const result = await api.auth.resetDatabase();
    if (result.reset) setSetup(true);
    return result.reset;
  };
  if (!user)
    return (
      <AuthScreen
        setup={setup}
        onSubmit={signIn}
        onRecover={recoverAccount}
        onResetDatabase={resetDatabase}
      />
    );

  const pageNames = {
    overview: "Overview",
    students: "Students",
    teachers: "Teachers",
    classes: "Classes",
    halls: "Halls",
    attendance: "Attendance",
    payments: "Payments",
    reports: "Reports",
    settings: "Settings",
  };
  const openPage = (destination) => {
    setPage(destination);
    setSidebar(false);
  };
  const doLogout = async () => {
    await api.auth.logout();
    setUser(null);
    setPage("overview");
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={22} />
          </div>
          <div>
            <div className="brand-name">Classroom</div>
            <div className="brand-caption">TUITION MANAGER</div>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebar(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="org-switcher">
          <div className="org-avatar">{initials(user.organization)}</div>
          <div className="org-copy">
            <b>{user.organization}</b>
            <span>
              {user.role === "admin" ? "Administrator" : "Staff account"}
            </span>
          </div>
          <ChevronDown size={15} className="muted" />
        </div>
        <nav className="nav-list">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map(([label, key, Icon]) => (
                <button
                  className={`nav-item ${page === key ? "active" : ""}`}
                  key={key}
                  onClick={() => openPage(key)}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {/* <div className="sidebar-prompt">
            <div className="prompt-icon">
              <Sparkles size={16} />
            </div>
            <b>Everything in one place</b>
            <p>Students, classes and payments, organized simply.</p>
            <button onClick={() => openPage("settings")}>
              Explore settings <ArrowRight size={13} />
            </button>
          </div> */}
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => openPage("settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button className="profile-row" onClick={doLogout}>
            <div className="avatar avatar-purple">
              {initials(user.username)}
            </div>
            <div className="profile-text">
              <b>{user.username}</b>
              <span>Sign out of account</span>
            </div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {sidebar && (
        <button
          className="backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebar(true)}
            aria-label="Open menu"
          >
            <Menu size={19} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{pageNames[page]}</b>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="Search"
                placeholder="Search students, RFID…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={async (event) => {
                  if (event.key === "Enter" && query.trim()) {
                    try {
                      const result = await api.students.byRfid(query.trim());
                      if (result) {
                        setPage("students");
                        setModal({ type: "student-detail", student: result });
                      } else
                        notify(
                          "No student found for that card number.",
                          "error",
                        );
                    } catch (error) {
                      notify(error.message, "error");
                    }
                  }
                }}
              />
              <kbd>↵</kbd>
            </div>
            <div className="topbar-date">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </div>
            <button
              className="avatar avatar-purple header-avatar"
              title={user.username}
              onClick={doLogout}
            >
              {initials(user.username)}
            </button>
          </div>
        </header>
        <div className="page-container" key={page}>
          <ErrorBoundary>
            <PageContent
              page={page}
              version={version}
              refresh={refresh}
              notify={notify}
              setModal={setModal}
              user={user}
              setUser={setUser}
            />
          </ErrorBoundary>
        </div>
      </main>
      {modal && (
        <ModalHost
          modal={modal}
          close={() => setModal(null)}
          refresh={refresh}
          version={version}
          notify={notify}
          setModal={setModal}
          navigate={openPage}
        />
      )}
      {toast && (
        <div className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === "error" ? (
              <CircleHelp size={17} />
            ) : (
              <Check size={17} />
            )}
          </span>
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ErrorBoundary({ children }) {
  const [error, setError] = useState(null);
  if (error)
    return (
      <div className="error-panel">
        <div className="empty-symbol">
          <CircleHelp size={22} />
        </div>
        <h2>We couldn’t load this page</h2>
        <p>{error.message}</p>
        <button
          className="button button-primary"
          onClick={() => {
            setError(null);
            window.location.reload();
          }}
        >
          Try again
        </button>
      </div>
    );
  return <Boundary onError={setError}>{children}</Boundary>;
}
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    this.props.onError(error);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

function AuthScreen({ setup, onSubmit, onRecover, onResetDatabase }) {
  const [form, setForm] = useState({
    organization: "",
    username: "",
    password: "",
    contact: "",
  });
  const [recoveryForm, setRecoveryForm] = useState({
    organization: "",
    contact: "",
    password: "",
  });
  const [recovering, setRecovering] = useState(false);
  const [imageDirectory, setImageDirectory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key) => (event) =>
    setForm((old) => ({ ...old, [key]: event.target.value }));
  const updateRecovery = (key) => (event) =>
    setRecoveryForm((old) => ({ ...old, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(setup ? { ...form, image_directory: imageDirectory } : form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const recover = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onRecover(recoveryForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      await onResetDatabase();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const chooseImageDirectory = async () => {
    setError("");
    try {
      const result = await api.images.chooseDirectory(imageDirectory);
      if (!result.canceled) setImageDirectory(result.directory);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-decoration decoration-one" />
      <div className="auth-decoration decoration-two" />
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">
            <GraduationCap size={24} />
          </div>
          <span>Classroom</span>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">
            {setup
              ? "LET’S GET STARTED"
              : recovering
                ? "ACCOUNT RECOVERY"
                : "WELCOME BACK"}
          </span>
          <h1>
            {setup
              ? "Set up your workspace"
              : recovering
                ? "Reset your password"
                : "Sign in to your workspace"}
          </h1>
          <p>
            {setup
              ? "Create your tuition centre account to get started. Your data stays safely on this device."
              : recovering
                ? "Enter the tuition centre name and contact number saved on this device, then set a new password. Your existing username will stay the same."
                : "Enter your username and password to continue managing your classes."}
          </p>
        </div>
        {recovering && !setup ? (
          <form onSubmit={recover} className="auth-form">
            <Field
              label="Tuition centre name"
              required
              value={recoveryForm.organization}
              onChange={updateRecovery("organization")}
              placeholder="Name saved during setup"
            />
            <Field
              label="Contact number on file"
              required
              value={recoveryForm.contact}
              onChange={updateRecovery("contact")}
              placeholder="Contact number saved during setup"
            />
            <Field
              label="New password"
              required
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={recoveryForm.password}
              onChange={updateRecovery("password")}
              placeholder="At least 8 characters"
            />
            {error && <div className="form-error">{error}</div>}
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? "Please wait…" : "Reset password"}
              <ArrowRight size={16} />
            </button>
            <p className="auth-recovery-note">
              Recovery verifies the organization name and contact number saved
              on this device. Your username is not changed; you can sign in
              with it and the new password after verification.
            </p>
            <button
              type="button"
              className="auth-recovery-link"
              onClick={() => {
                setRecovering(false);
                setError("");
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="auth-form">
            {setup && (
              <>
                <Field
                  label="Tuition centre name"
                  required
                  value={form.organization}
                  onChange={update("organization")}
                  placeholder="e.g. Bright Future Academy"
                />
                <Field
                  label="Contact number"
                  value={form.contact}
                  onChange={update("contact")}
                  placeholder="Optional"
                />
                <Field label="Student photo storage folder" required>
                  <div className="directory-picker">
                    <input readOnly value={imageDirectory} placeholder="Choose a local folder for student photos" />
                    <Button kind="secondary" type="button" onClick={chooseImageDirectory} disabled={busy}>
                      Choose folder
                    </Button>
                  </div>
                  <small>Student photos are stored outside the database and are not included in backups.</small>
                </Field>
              </>
            )}
            <Field
              label="Username"
              required
              autoComplete="username"
              value={form.username}
              onChange={update("username")}
              placeholder="Your username"
            />
            <Field
              label="Password"
              required
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 8 : undefined}
              value={form.password}
              onChange={update("password")}
              placeholder={setup ? "At least 8 characters" : "Your password"}
            />
            {error && <div className="form-error">{error}</div>}
            <button className="button button-primary auth-submit" disabled={busy}>
              {busy ? "Please wait…" : setup ? "Create workspace" : "Sign in"}
              <ArrowRight size={16} />
            </button>
            {!setup && (
              <>
                <button
                  type="button"
                  className="auth-recovery-link"
                  onClick={() => {
                    setRecovering(true);
                    setError("");
                  }}
                >
                  Forgot your password? Reset it with your organization details
                </button>
                <button
                  type="button"
                  className="auth-reset-link"
                  disabled={busy}
                  onClick={reset}
                >
                  Reset all local data and start over
                </button>
              </>
            )}
          </form>
        )}
        <div className="auth-security">
          <ShieldCheck size={16} />
          <span>Your data is stored securely on this device</span>
        </div>
      </div>
      <div className="auth-footer">
        A thoughtful workspace for better learning <span>·</span> Tuition
        Manager
      </div>
    </main>
  );
}

function Field({ label, required, children, className = "", ...props }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required && <i>*</i>}
      </span>
      {children || <input {...props} required={required} />}
    </label>
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  className = "",
}) {
  return (
    <Field label={label} required={required} className={className}>
      {options.length > 3 ? (
        <SearchableSelect
          value={value}
          options={options}
          required={required}
          ariaLabel={label}
          onValueChange={(next) => onChange({ target: { value: next } })}
        />
      ) : (
        <select value={value} onChange={onChange} required={required}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder = "Search options…",
  ariaLabel,
  required = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => String(option.value) === String(value));
  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const choose = (option) => {
    onValueChange(option.value);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className={`search-select ${className}`}>
      <input
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-required={required}
        required={required}
        placeholder={open || !selected ? placeholder : ""}
        value={open ? query : selected?.label || ""}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && open && matches[0]) {
            event.preventDefault();
            choose(matches[0]);
          }
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <div className="search-select-options" role="listbox">
          {matches.slice(0, 3).map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={String(option.value) === String(value)}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
          {!matches.length && (
            <span className="search-select-empty">No matching options</span>
          )}
          {matches.length > 3 && (
            <span className="search-select-more">Type to narrow results</span>
          )}
        </div>
      )}
    </div>
  );
}
function PageHeading({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Button({
  children,
  kind = "primary",
  icon: Icon,
  onClick,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      className={`button button-${kind}`}
      onClick={onClick}
      {...props}
    >
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children}
    </button>
  );
}
function Status({ value }) {
  const label = value === "not_marked" ? "Not marked" : value;
  return (
    <span className={`status status-${String(value).replaceAll("_", "-")}`}>
      <span />
      {label?.replace(/^./, (letter) => letter.toUpperCase())}
    </span>
  );
}
function Avatar({ name, color = "blue", photo, className = "" }) {
  return photo ? (
    <img
      className={`avatar avatar-photo ${className}`}
      src={photo}
      alt={`${name} profile`}
      onError={(event) => { event.currentTarget.src = defaultProfilePhoto; }}
    />
  ) : (
    <div className={`avatar avatar-${color} ${className}`}>{initials(name)}</div>
  );
}
function StudentAvatar({ stid, name, version, className = "" }) {
  const { data } = useLoad(
    () => stid ? api.students.photo(stid) : Promise.resolve(null),
    [stid, version],
  );
  return (
    <Avatar
      name={name}
      photo={data || defaultProfilePhoto}
      className={className}
    />
  );
}
function EmptyState({ title, detail, action }) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <BookOpen size={22} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function TableToolbar({
  count,
  placeholder = "Search…",
  query,
  setQuery,
  children,
}) {
  return (
    <div className="table-toolbar">
      <div className="table-search">
        <Search size={16} />
        <input
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="toolbar-right">
        <span className="record-count">
          {count} {count === 1 ? "record" : "records"}
        </span>
        {children}
      </div>
    </div>
  );
}
function Pagination({ count, page, setPage }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages, setPage]);
  const first = count ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, count);
  return (
    <div className="pagination">
      <span>Showing {first}–{last} of {count}</span>
      <div>
        <button
          className="pagination-button"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span>Page {page} of {pages}</span>
        <button
          className="pagination-button"
          onClick={() => setPage((value) => Math.min(pages, value + 1))}
          disabled={page >= pages}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
const pageSlice = (rows, page) =>
  rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    loader()
      .then((result) => {
        if (alive) {
          setData(result);
          setError("");
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, deps);
  return { data, setData, error };
}

function PageContent({
  page,
  version,
  refresh,
  notify,
  setModal,
  user,
  setUser,
}) {
  if (page === "overview")
    return (
      <Dashboard
        version={version}
        refresh={refresh}
        setModal={setModal}
        notify={notify}
      />
    );
  if (page === "students")
    return (
      <StudentsPage
        version={version}
        refresh={refresh}
        setModal={setModal}
        notify={notify}
      />
    );
  if (page === "teachers")
    return (
      <TeachersPage
        version={version}
        refresh={refresh}
        setModal={setModal}
        notify={notify}
      />
    );
  if (page === "classes")
    return (
      <ClassesPage
        version={version}
        refresh={refresh}
        setModal={setModal}
        notify={notify}
      />
    );
  if (page === "halls")
    return (
      <HallsPage version={version} setModal={setModal} />
    );
  if (page === "attendance")
    return (
      <AttendancePage
        version={version}
        refresh={refresh}
        setModal={setModal}
        notify={notify}
      />
    );
  if (page === "payments")
    return (
      <PaymentsPage
        version={version}
        setModal={setModal}
        notify={notify}
        refresh={refresh}
      />
    );
  if (page === "reports")
    return (
      <ReportsPage
        version={version}
        setModal={setModal}
        notify={notify}
        user={user}
      />
    );
  return (
    <SettingsPage
      user={user}
      setUser={setUser}
      notify={notify}
      refresh={refresh}
    />
  );
}

function Dashboard({ version, refresh, setModal, notify }) {
  const { data, error } = useLoad(() => api.dashboard.get(), [version]);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const sessions = (data?.sessions || []).filter((session) =>
    `${session.class_name} ${session.subject || ""}`
      .toLowerCase()
      .includes(sessionQuery.trim().toLowerCase()),
  );
  const visibleSessions = pageSlice(sessions, sessionPage);
  useEffect(() => setSessionPage(1), [sessionQuery]);
  if (!data && !error)
    return <div className="loading-panel">Loading your overview…</div>;
  if (error) return <div className="error-inline">{error}</div>;
  const stats = [
    ["Active students", data.students, Users, "blue"],
    ["Teaching staff", data.teachers, GraduationCap, "purple"],
    ["Active classes", data.classes, BookOpen, "orange"],
    ["Collected this month", money(data.collected), Wallet, "green"],
  ];
  const weekday = new Date()
    .toLocaleDateString(undefined, { weekday: "long" })
    .toUpperCase();
  return (
    <div className="page-content">
      <PageHeading
        eyebrow={`${weekday}, YOUR WORKSPACE AT A GLANCE`}
        title="Good day"
        subtitle="Here’s what’s happening at your tuition centre."
        action={
          <Button
            icon={Plus}
            onClick={() => setModal({ type: "student-form" })}
          >
            Add a student
          </Button>
        }
      />
      <div className="stats-grid">
        {stats.map(([label, value, Icon, color]) => (
          <div className="stat-card" key={label}>
            <div className={`stat-icon stat-${color}`}>
              <Icon size={18} />
            </div>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
            <div className="stat-foot">
              {label === "Collected this month"
                ? "For the current month"
                : "Across your workspace"}
            </div>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel sessions-panel">
          <div className="panel-heading">
            <div>
              <h2>Today’s sessions</h2>
              <p>Your classes on the timetable today</p>
            </div>
            <button
              className="text-link"
              onClick={() => setModal({ type: "go-page", page: "attendance" })}
            >
              Attendance <ArrowRight size={14} />
            </button>
          </div>
          <div className="dashboard-session-search">
            <TableToolbar
              count={sessions.length}
              placeholder="Search today's classes…"
              query={sessionQuery}
              setQuery={setSessionQuery}
            />
          </div>
          {sessions.length ? (
            <div className="session-list">
              {visibleSessions.map((session) => (
                <div className="session-row" key={session.session_id}>
                  <div className="session-time">
                    <Clock3 size={14} />
                    {session.start_time || "—"}
                  </div>
                  <div className="session-color-bar" />
                  <div className="session-info">
                    <b>{session.class_name}</b>
                    <span>
                      {session.subject || "Class session"}
                      {session.end_time ? ` · until ${session.end_time}` : ""}
                    </span>
                  </div>
                  <Status value={session.status} />
                  <button
                    className="icon-button row-action"
                    onClick={() => setModal({ type: "session", session })}
                    aria-label="Open session"
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              ))}
              <Pagination
                count={sessions.length}
                page={sessionPage}
                setPage={setSessionPage}
              />
            </div>
          ) : (
            <div className="session-empty">
              <div className="empty-symbol">
                <CalendarDays size={19} />
              </div>
              <div>
                <b>                {sessionQuery ? "No sessions match your search" : "Nothing on the timetable today"}</b>
                <span>
                  Head to Attendance to generate sessions from class schedules.
                </span>
              </div>
              <Button
                kind="secondary"
                onClick={() =>
                  setModal({ type: "go-page", page: "attendance" })
                }
              >
                View attendance
              </Button>
            </div>
          )}
        </section>
        <section className="panel collection-panel">
          <div className="panel-heading">
            <div>
              <h2>This month</h2>
              <p>Tuition fee overview</p>
            </div>
            <div className="month-pill">
              <CalendarDays size={13} />
              {new Date().toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
          <div className="collection-amount">{money(data.collected)}</div>
          <div className="collection-caption">collected this month</div>
          <div className="collection-track">
            <div
              style={{
                width: `${data.collected + data.pending === 0 ? 0 : Math.min(100, (data.collected / (data.collected + data.pending)) * 100)}%`,
              }}
            />
          </div>
          <div className="collection-legend">
            <span>
              <i className="legend-green" />
              Collected <b>{money(data.collected)}</b>
            </span>
            <span>
              <i className="legend-gray" />
              Pending <b>{money(data.pending)}</b>
            </span>
          </div>
          <button
            className="collection-link"
            onClick={() => setModal({ type: "go-page", page: "payments" })}
          >
            View payment details <ArrowRight size={14} />
          </button>
        </section>
      </div>
      <section className="panel backup-reminder">
        <div className="backup-art">
          <ShieldCheck size={21} />
        </div>
        <div>
          <b>Keep your records safe</b>
          <span>
            {data.lastBackup
              ? `Last backup: ${prettyDate(data.lastBackup.created_at?.slice(0, 10))}`
              : "You haven’t backed up your records yet. It only takes a moment."}
          </span>
        </div>
        <Button
          kind="secondary"
          icon={ArrowDownToLine}
          onClick={async () => {
            try {
              const result = await api.backup.create();
              if (!result.canceled) {
                notify("Your database backup is ready.");
                refresh();
              }
            } catch (error) {
              notify(error.message, "error");
            }
          }}
        >
          Back up data
        </Button>
      </section>
    </div>
  );
}

function ExcelActions({ records, label, refresh, notify }) {
  const [busy, setBusy] = useState(false);
  const downloadTemplate = async () => {
    setBusy(true);
    try {
      const result = await records.downloadTemplate();
      if (!result.canceled) notify(`${label} Excel template downloaded.`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const importRecords = async () => {
    setBusy(true);
    try {
      const result = await records.importExcel();
      if (!result.canceled) {
        notify(`Imported ${result.count} ${label} from ${result.fileName}.`);
        refresh();
      }
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button kind="secondary" icon={Download} onClick={downloadTemplate} disabled={busy}>
        Excel template
      </Button>
      <Button kind="secondary" icon={Upload} onClick={importRecords} disabled={busy}>
        Import Excel
      </Button>
    </>
  );
}

function StudentsPage({ version, refresh, setModal, notify }) {
  const { data, error } = useLoad(() => api.students.list(), [version]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = useMemo(
    () =>
      (data || []).filter((student) =>
        `${student.name} ${student.school || ""} ${student.contact1} ${student.rfid || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data, query],
  );
  const visibleRows = pageSlice(rows, page);
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="YOUR LEARNERS"
        title="Students"
        subtitle="Keep student details and class memberships in one easy place."
        action={
          <div className="heading-actions">
            <ExcelActions records={api.students} label="students" refresh={refresh} notify={notify} />
            <Button
              kind="secondary"
              icon={Users}
              onClick={() => setModal({ type: "enrollment-form" })}
            >
              Enroll in a class
            </Button>
            <Button
              icon={Plus}
              onClick={() => setModal({ type: "student-form" })}
            >
              Add student
            </Button>
          </div>
        }
      />
      <div className="panel data-panel">
        <TableToolbar
          count={rows.length}
          placeholder="Find a student…"
          query={query}
          setQuery={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
        {error && <div className="error-inline">{error}</div>}
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>SCHOOL</th>
                  <th>CONTACT</th>
                  <th>RFID CARD</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((student) => (
                  <tr
                    key={student.stid}
                    onClick={() =>
                      setModal({ type: "student-detail", student })
                    }
                  >
                    <td>
                      <div className="person-cell">
                        <StudentAvatar stid={student.stid} name={student.name} version={version} />
                        <div>
                          <b>{student.name}</b>
                          <span>
                            {ageFromBirthday(student.birthday) === null
                              ? "Student"
                              : `Age ${ageFromBirthday(student.birthday)}`}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {student.school || <span className="muted">—</span>}
                    </td>
                    <td>{student.contact1}</td>
                    <td>
                      {student.rfid ? (
                        <span className="rfid-chip">
                          <Activity size={12} />
                          {student.rfid}
                        </span>
                      ) : (
                        <span className="muted">Not assigned</span>
                      )}
                    </td>
                    <td>
                      <Status value={student.status} />
                    </td>
                    <td>
                      <button
                        className="icon-button row-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          setModal({ type: "student-form", student });
                        }}
                        aria-label="Edit student"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : error ? null : (
          <EmptyState
            title={
              query
                ? "No students match your search"
                : "Your student list is ready"
            }
            detail={
              query
                ? "Try a different name, school, contact or RFID."
                : "Add your first student to start building your tuition centre’s records."
            }
            action={
              !query && (
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "student-form" })}
                >
                  Add your first student
                </Button>
              )
            }
          />
        )}
        {!error && rows.length > 0 && (
          <Pagination count={rows.length} page={page} setPage={setPage} />
        )}
      </div>
    </div>
  );
}

function TeachersPage({ version, refresh, setModal, notify }) {
  const { data, error } = useLoad(() => api.teachers.list(), [version]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = (data || []).filter((row) =>
    `${row.name} ${row.contact || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleRows = pageSlice(rows, page);
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="THE PEOPLE WHO TEACH"
        title="Teachers"
        subtitle="Manage your teaching team and see who leads each class."
        action={
          <div className="heading-actions">
            <ExcelActions records={api.teachers} label="teachers" refresh={refresh} notify={notify} />
            <Button
              icon={Plus}
              onClick={() => setModal({ type: "teacher-form" })}
            >
              Add teacher
            </Button>
          </div>
        }
      />
      <div className="panel data-panel">
        <TableToolbar
          count={rows.length}
          placeholder="Find a teacher…"
          query={query}
          setQuery={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
        {error && <div className="error-inline">{error}</div>}
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>TEACHER</th>
                  <th>CONTACT</th>
                  <th>ADDRESS</th>
                  <th>ABOUT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row.tid}>
                    <td>
                      <div className="person-cell">
                        <Avatar
                          name={row.name}
                          color={
                            ["blue", "purple", "orange", "green"][index % 4]
                          }
                        />
                        <div>
                          <b>{row.name}</b>
                          <span>Teaching staff</span>
                        </div>
                      </div>
                    </td>
                    <td>{row.contact || "—"}</td>
                    <td>{row.address || "—"}</td>
                    <td className="cell-truncate">{row.description || "—"}</td>
                    <td>
                      <button
                        className="icon-button row-action"
                        onClick={() =>
                          setModal({ type: "teacher-form", teacher: row })
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={query ? "No teachers found" : "Meet your teaching team"}
            detail={
              query
                ? "Try another search."
                : "Add a teacher and assign them to a class."
            }
            action={
              !query && (
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "teacher-form" })}
                >
                  Add your first teacher
                </Button>
              )
            }
          />
        )}
        {!error && rows.length > 0 && (
          <Pagination count={rows.length} page={page} setPage={setPage} />
        )}
      </div>
    </div>
  );
}

function ClassesPage({ version, setModal }) {
  const { data, error } = useLoad(() => api.classes.list(), [version]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = (data || []).filter((row) =>
    `${row.class_name} ${row.teacher_name} ${row.subject || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleRows = pageSlice(rows, page);
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="YOUR PROGRAMME"
        title="Classes"
        subtitle="Set up subjects, timetables, fees and student enrolments."
        action={
          <div className="heading-actions">
            <Button
              kind="secondary"
              icon={Users}
              onClick={() => setModal({ type: "enrollment-form" })}
            >
              Enroll students
            </Button>
            <Button
              icon={Plus}
              onClick={() => setModal({ type: "class-form" })}
            >
              Create class
            </Button>
          </div>
        }
      />
      <div className="panel data-panel">
        <TableToolbar
          count={rows.length}
          placeholder="Find a class…"
          query={query}
          setQuery={(value) => {
            setQuery(value);
            setPage(1);
          }}
        >
          <button
            className="filter-button"
            onClick={() => setModal({ type: "hall-form" })}
          >
            <Plus size={14} /> Add a hall
          </button>
        </TableToolbar>
        {error && <div className="error-inline">{error}</div>}
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CLASS</th>
                  <th>TEACHER</th>
                  <th>STUDENTS</th>
                  <th>MONTHLY FEE</th>
                  <th>TEACHER SHARE</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    key={row.class_id}
                    onClick={() =>
                      setModal({ type: "class-detail", classItem: row })
                    }
                  >
                    <td>
                      <div className="class-cell">
                        <div className={`class-icon class-color-${index % 4}`}>
                          <BookOpen size={16} />
                        </div>
                        <div>
                          <b>{row.class_name}</b>
                          <span>
                            {row.subject || "General class"}
                            {row.hall_name ? ` · ${row.hall_name}` : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>{row.teacher_name}</td>
                    <td>
                      <button
                        className="enroll-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          setModal({ type: "class-detail", classItem: row });
                        }}
                      >
                        <Users size={13} />
                        {row.student_count} · Enroll
                      </button>
                    </td>
                    <td>
                      <b className="table-money">{money(row.fee)}</b>
                    </td>
                    <td>{row.teacher_commission_percentage}%</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      <button
                        className="icon-button row-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          setModal({ type: "class-form", classItem: row });
                        }}
                        aria-label="Edit class"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={query ? "No classes found" : "Make space for learning"}
            detail={
              query
                ? "Try another search."
                : "Create a class, add a teacher and set your monthly fee."
            }
            action={
              !query && (
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "class-form" })}
                >
                  Create your first class
                </Button>
              )
            }
          />
        )}
        {!error && rows.length > 0 && (
          <Pagination count={rows.length} page={page} setPage={setPage} />
        )}
      </div>
    </div>
  );
}

function HallsPage({ version, setModal }) {
  const { data, error } = useLoad(() => api.halls.list(), [version]);
  const [hallTab, setHallTab] = useState("calendar");
  const [query, setQuery] = useState("");
  const [findDay, setFindDay] = useState("monday");
  const [findStart, setFindStart] = useState("09:00");
  const [findEnd, setFindEnd] = useState("10:00");
  const [page, setPage] = useState(1);
  const halls = (data || []).filter((hall) =>
    `${hall.name} ${hall.availability.map((slot) => slot.day_of_week).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visibleHalls = pageSlice(halls, page);
  const weekDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const availableHalls = halls.filter((hall) =>
    findStart < findEnd
    && hall.availability.some((slot) =>
      slot.day_of_week === findDay && slot.start_time <= findStart && slot.end_time >= findEnd)
    && !(hall.bookings || []).some((booking) =>
      booking.day_of_week === findDay && findStart < booking.end_time && booking.start_time < findEnd),
  );
  const availabilityText = (slots) =>
    slots.length
      ? slots
          .map(
            (slot) =>
              `${slot.day_of_week[0].toUpperCase() + slot.day_of_week.slice(1, 3)} ${new Date(`2000-01-01T${slot.start_time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${new Date(`2000-01-01T${slot.end_time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
          )
          .join(" · ")
      : "No times available";
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="ROOMS & TIMETABLES"
        title="Halls"
        subtitle="Manage rooms and the days and times they’re available for classes."
        action={
          <Button icon={Plus} onClick={() => setModal({ type: "hall-form" })}>
            Add hall
          </Button>
        }
      />
      <div className="report-tabs hall-tabs" role="tablist" aria-label="Hall sections">
        <button type="button" role="tab" aria-selected={hallTab === "calendar"} className={hallTab === "calendar" ? "active" : ""} onClick={() => setHallTab("calendar")}>Availability calendar</button>
        <button type="button" role="tab" aria-selected={hallTab === "find"} className={hallTab === "find" ? "active" : ""} onClick={() => setHallTab("find")}>Find availability</button>
        <button type="button" role="tab" aria-selected={hallTab === "list"} className={hallTab === "list" ? "active" : ""} onClick={() => setHallTab("list")}>Halls list</button>
      </div>
      {error && <div className="error-inline">{error}</div>}
      {hallTab === "list" && (
      <div className="panel data-panel">
        <TableToolbar
          count={halls.length}
          placeholder="Find a hall…"
          query={query}
          setQuery={(value) => {
            setQuery(value);
            setPage(1);
          }}
        >
          <button
            className="filter-button"
            onClick={() => setModal({ type: "class-form" })}
          >
            <Plus size={14} /> Create class
          </button>
        </TableToolbar>
        {halls.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>HALL</th>
                  <th>CAPACITY</th>
                  <th>WEEKLY AVAILABILITY</th>
                  <th>CLASSES</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleHalls.map((hall) => (
                  <tr key={hall.hall_id}>
                    <td>
                      <div className="class-cell">
                        <div className="hall-icon">
                          <DoorOpen size={16} />
                        </div>
                        <div>
                          <b>{hall.name}</b>
                          <span>Teaching space</span>
                        </div>
                      </div>
                    </td>
                    <td>{hall.capacity || "Not set"}</td>
                    <td className="availability-cell">
                      {availabilityText(hall.availability)}
                    </td>
                    <td>{hall.class_count}</td>
                    <td>
                      <button
                        className="small-action"
                        onClick={() => setModal({ type: "hall-form", hall })}
                      >
                        Edit hall
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              query
                ? "No halls match your search"
                : "Add your first teaching space"
            }
            detail={
              query
                ? "Try a different hall name or day."
                : "Set when each room is available. Classes can only use halls at available times."
            }
            action={
              !query && (
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "hall-form" })}
                >
                  Add a hall
                </Button>
              )
            }
          />
        )}
        {!error && halls.length > 0 && (
          <Pagination count={halls.length} page={page} setPage={setPage} />
        )}
      </div>
      )}
      {hallTab === "find" && (
        <section className="panel hall-availability-search">
          <div className="report-heading">
            <div><h2>Find an available hall</h2><p>Choose a day and time to see rooms that are open and not already booked.</p></div>
          </div>
          <div className="hall-search-fields">
            <label>Day
              <select value={findDay} onChange={(event) => setFindDay(event.target.value)}>
                {weekDays.map((day) => <option value={day} key={day}>{day[0].toUpperCase() + day.slice(1)}</option>)}
              </select>
            </label>
            <label>From
              <input type="time" value={findStart} onChange={(event) => setFindStart(event.target.value)} />
            </label>
            <label>Until
              <input type="time" value={findEnd} onChange={(event) => setFindEnd(event.target.value)} />
            </label>
          </div>
          {findStart >= findEnd ? (
            <div className="form-error">Choose an end time later than the start time.</div>
          ) : availableHalls.length ? (
            <div className="hall-availability-results">
              {availableHalls.map((hall) => (
                <article className="hall-availability-result" key={hall.hall_id}>
                  <div className="hall-icon"><DoorOpen size={17} /></div>
                  <div><b>{hall.name}</b><span>{findDay[0].toUpperCase() + findDay.slice(1)} · {findStart}–{findEnd}</span></div>
                  <span className="hall-capacity-badge">Capacity {hall.capacity || "Not set"}</span>
                  <button className="small-action" onClick={() => setModal({ type: "hall-form", hall })}>Edit hall</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="payout-empty">No halls are available for this day and time. Try another time or add hall availability.</div>
          )}
        </section>
      )}
      <div className="hall-guidance">
        <DoorOpen size={16} />
        <span>
          Class times are checked against hall availability. Two classes can’t
          use the same hall at overlapping times.
        </span>
      </div>
      {hallTab === "calendar" && <section className="panel hall-calendar">
        <div className="report-heading">
          <div>
            <h2>Weekly hall availability</h2>
            <p>Booked class times are highlighted in red with enrolment and capacity.</p>
          </div>
          <span className="calendar-legend"><i /> Booked class</span>
        </div>
        <div className="hall-calendar-scroll">
          <div className="hall-calendar-grid">
            <div className="hall-calendar-head hall-calendar-hall">HALL</div>
            {weekDays.map((day) => (
              <div className="hall-calendar-head" key={day}>{day.slice(0, 3).toUpperCase()}</div>
            ))}
            {visibleHalls.map((hall) => (
              <React.Fragment key={hall.hall_id}>
                <div className="hall-calendar-name">
                  <b>{hall.name}</b>
                  <span>Capacity {hall.capacity || "Not set"}</span>
                </div>
                {weekDays.map((day) => {
                  const bookings = (hall.bookings || []).filter((slot) => slot.day_of_week === day);
                  const availability = hall.availability.filter((slot) => slot.day_of_week === day);
                  return (
                    <div className="hall-calendar-cell" key={`${hall.hall_id}-${day}`}>
                      {bookings.length ? bookings.map((booking) => (
                        <div className="hall-booking" key={`${booking.class_id}-${booking.start_time}`}>
                          <b>{booking.class_name}</b>
                          <span>{booking.start_time}–{booking.end_time}</span>
                          <small>{booking.student_count} enrolled · capacity {hall.capacity || "—"}</small>
                        </div>
                      )) : availability.length ? availability.map((slot) => (
                        <div className="hall-open-slot" key={slot.availability_id}>
                          Available<br />{slot.start_time}–{slot.end_time}
                        </div>
                      )) : <span className="hall-closed">No availability</span>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
            {!visibleHalls.length && <div className="hall-calendar-empty">No halls match the current search.</div>}
          </div>
        </div>
      </section>}
    </div>
  );
}

function AttendancePage({ version, refresh, setModal, notify }) {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(
    () => api.sessions.list(date),
    [date, version],
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const sessions = (data || []).filter((session) =>
    `${session.class_name} ${session.subject || ""} ${session.status}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const visibleSessions = pageSlice(sessions, page);
  useEffect(() => setPage(1), [date, query]);
  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    setGenerating(true);
    try {
      const result = await api.sessions.generate(date);
      notify(
        result.created
          ? `${result.created} session${result.created === 1 ? "" : "s"} added to the timetable.`
          : "The timetable is already up to date.",
      );
      refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setGenerating(false);
    }
  };
  const changeDate = (amount) => {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + amount);
    setDate(next.toISOString().slice(0, 10));
  };
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="EVERY STUDENT, ACCOUNTED FOR"
        title="Attendance"
        subtitle="Start a session, mark who’s here and let the register do the rest."
        action={
          <div className="heading-actions">
            <Button kind="secondary" icon={CalendarDays} onClick={() => setModal({ type: "special-session-form", date })}>
              Add special session
            </Button>
            <Button icon={Plus} onClick={generate} disabled={generating}>
              {generating ? "Checking timetable…" : "Generate sessions"}
            </Button>
          </div>
        }
      />
      <div className="date-toolbar panel">
        <div>
          <div className="date-title">
            {date === today() ? "Today" : prettyDate(date)}
          </div>
          <span>
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="date-actions">
          <button
            className="icon-button"
            onClick={() => changeDate(-1)}
            aria-label="Previous day"
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-label="Attendance date"
          />
          <button className="today-button" onClick={() => setDate(today())}>
            Today
          </button>
          <button
            className="icon-button"
            onClick={() => changeDate(1)}
            aria-label="Next day"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="panel data-panel attendance-search">
        <TableToolbar
          count={sessions.length}
          placeholder="Search sessions by class or subject…"
          query={query}
          setQuery={setQuery}
        />
      </div>
      {error && <div className="error-inline">{error}</div>}
      {sessions.length ? (
        <div className="attendance-grid">
          {visibleSessions.map((session) => (
            <article className="attendance-card panel" key={session.session_id}>
              <div className="attendance-card-top">
                <div className="class-icon class-color-0">
                  <BookOpen size={17} />
                </div>
                {session.is_special === 1 && <span className="attendance-special-tag">One-time</span>}
                <Status value={session.status} />
              </div>
              <h3>{session.class_name}</h3>
              <p>{session.is_special ? "One-time special session" : session.subject || "Class session"}</p>
              <div className="attendance-meta">
                <span>
                  <Clock3 size={14} />
                  {session.start_time || "Time not set"}
                  {session.end_time ? ` – ${session.end_time}` : ""}
                </span>
                <span>
                  <Users size={14} />
                  {session.present_count} / {session.roster_count} present
                </span>
                {session.hall_name && <span><DoorOpen size={14} />{session.hall_name}</span>}
              </div>
              <div className="attendance-card-footer">
                <span className={session.ended_automatically ? "session-auto-ended-label" : ""}>
                  {session.ended_automatically
                    ? "Automatically ended"
                    : session.status === "ongoing"
                      ? session.class_started_at
                        ? `Class started at ${prettyTimestamp(session.class_started_at)}`
                        : "Register is open"
                      : session.status === "completed"
                        ? "Register completed"
                        : "Ready for roll call"}
                </span>
                <Button
                  kind={session.status === "ongoing" ? "primary" : "secondary"}
                  onClick={() => setModal({ type: "session", session })}
                >
                  {session.status === "ongoing"
                    ? "Take attendance"
                    : session.status === "completed"
                      ? "View register"
                      : "Start session"}
                </Button>
              </div>
            </article>
          ))}
            <div className="attendance-pagination">
              <Pagination count={sessions.length} page={page} setPage={setPage} />
            </div>
        </div>
      ) : (
        !error && (
          <div className="panel empty-attendance">
            <div className="empty-symbol">
              <CalendarDays size={22} />
            </div>
            <h3>No sessions for this day</h3>
            <p>
              Generate sessions from your class schedules to prepare the
              attendance register.
            </p>
            <Button icon={Plus} onClick={generate} disabled={generating}>
              {generating ? "Checking timetable…" : "Generate today’s sessions"}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function PaymentsPage({ version, setModal, notify, refresh }) {
  const [month, setMonth] = useState(thisMonth());
  const [paymentTab, setPaymentTab] = useState("make");
  const [studentFilter, setStudentFilter] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState("3");
  const [historyMonth, setHistoryMonth] = useState(thisMonth());
  const [historyFrom, setHistoryFrom] = useState(shiftMonth(thisMonth(), -2));
  const [historyTo, setHistoryTo] = useState(thisMonth());
  const { data: studentList } = useLoad(() => api.students.list(), [version]);
  const { data, error } = useLoad(
    () => api.payments.overview(month),
    [month, version],
  );
  const historyRange = historyPeriod === "3"
    ? [shiftMonth(thisMonth(), -2), thisMonth()]
    : historyPeriod === "month"
      ? [historyMonth, historyMonth]
      : [historyFrom, historyTo];
  const studentHistory = useLoad(
    () => studentFilter
      ? api.reports.paymentRecords({
          stid: Number(studentFilter),
          start_month: historyRange[0],
          end_month: historyRange[1],
        })
      : Promise.resolve([]),
    [studentFilter, historyPeriod, historyMonth, historyFrom, historyTo, version],
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = data?.rows || [];
  const students = (studentList || []).filter((student) => student.status === "active");
  const filtered = rows.filter((row) =>
    `${row.name} ${row.rfid || ""} ${row.class_name}`.toLowerCase().includes(query.toLowerCase())
    && (!studentFilter || row.stid === Number(studentFilter)),
  );
  const visibleRows = pageSlice(filtered, page);
  const [selected, setSelected] = useState([]);
  useEffect(() => {
    setSelected([]);
    setPage(1);
  }, [month, data, studentFilter]);
  const unpaid = visibleRows.filter((row) => !row.payment_id && Number(row.discount_percentage) < 100 && Number(row.due_amount) > 0);
  const pay = async (ids) => {
    if (!ids.length) return;
    const reviewRows = rows.filter((row) => ids.includes(row.enrollment_id) && !row.payment_id
      && Number(row.discount_percentage) < 100 && Number(row.due_amount) > 0);
    if (reviewRows.length) setModal({ type: "payment-review", rows: reviewRows, month });
  };
  const exportHistory = async () => {
    try {
      const result = await api.reports.exportPDF();
      if (!result.canceled) notify("Filtered student payment history exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    }
  };
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="CLEAR, SIMPLE FEE TRACKING"
        title="Payments"
        subtitle="See what’s been collected and record monthly tuition fees."
        action={paymentTab === "students" ? (
          <Button
            icon={CreditCard}
            onClick={() => pay(selected)}
            disabled={!selected.length}
          >
            Record selected{selected.length ? ` (${selected.length})` : ""}
          </Button>
        ) : null}
      />
      <div className="report-tabs payment-tabs" role="tablist" aria-label="Payment sections">
        <button type="button" role="tab" aria-selected={paymentTab === "make"} className={paymentTab === "make" ? "active" : ""} onClick={() => setPaymentTab("make")}>Make payment</button>
        <button type="button" role="tab" aria-selected={paymentTab === "students"} className={paymentTab === "students" ? "active" : ""} onClick={() => setPaymentTab("students")}>Student payments</button>
        <button type="button" role="tab" aria-selected={paymentTab === "teachers"} className={paymentTab === "teachers" ? "active" : ""} onClick={() => setPaymentTab("teachers")}>Teacher payments</button>
        <button type="button" role="tab" aria-selected={paymentTab === "records"} className={paymentTab === "records" ? "active" : ""} onClick={() => setPaymentTab("records")}>Payment records</button>
      </div>
      {paymentTab === "make" ? (
        <MakePaymentPanel
          version={version}
          students={(studentList || []).filter((student) => student.status === "active")}
          setModal={setModal}
        />
      ) : paymentTab === "students" ? (
      <>
      <div className="payment-summary-grid">
        <div className="payment-summary panel">
          <div className="payment-summary-icon paid-icon">
            <CheckCheck size={18} />
          </div>
          <span>
            Collected in{" "}
            {new Date(`${month}-02`).toLocaleDateString(undefined, {
              month: "long",
            })}
          </span>
          <b>{money(data?.collected)}</b>
          <small>Payments received</small>
        </div>
        <div className="payment-summary panel">
          <div className="payment-summary-icon due-icon">
            <Clock3 size={18} />
          </div>
          <span>Outstanding this month</span>
          <b>{money(data?.due)}</b>
          <small>Based on enrolled students and discounts</small>
        </div>
        <div className="payment-summary panel">
          <div className="payment-summary-icon total-icon">
            <Wallet size={18} />
          </div>
          <span>Fees to collect</span>
          <b>{money(Number(data?.collected || 0) + Number(data?.due || 0))}</b>
          <small>Collected plus outstanding</small>
        </div>
      </div>
      <div className="panel data-panel">
        <TableToolbar
          count={filtered.length}
          placeholder="Find a student or class…"
          query={query}
          setQuery={(value) => {
            setQuery(value);
            setPage(1);
          }}
        >
          <SearchableSelect
            value={studentFilter}
            ariaLabel="Filter payments by student"
            placeholder="Search a student…"
            options={[
              { value: "", label: "All students" },
              ...students.map((student) => ({
                value: String(student.stid),
                label: student.name,
              })),
            ]}
            onValueChange={(value) => {
              setStudentFilter(value);
              setPage(1);
            }}
          />
          <input
            type="month"
            max={thisMonth()}
            className="month-input"
            aria-label="Payment month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setPage(1);
            }}
          />
          {selected.length > 0 && (
            <Button onClick={() => pay(selected)}>
              Collect {selected.length} selected
            </Button>
          )}
        </TableToolbar>
        {error && <div className="error-inline">{error}</div>}
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all unpaid"
                      checked={
                        unpaid.length > 0 &&
                        unpaid.every((row) =>
                          selected.includes(row.enrollment_id),
                        )
                      }
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? unpaid.map((row) => row.enrollment_id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>STUDENT</th>
                  <th>CLASS</th>
                  <th>MONTHLY FEE</th>
                  <th>DISCOUNT</th>
                  <th>AMOUNT DUE</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.enrollment_id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name} ${row.class_name}`}
                        disabled={Boolean(row.payment_id) || Number(row.discount_percentage) >= 100 || Number(row.due_amount) <= 0}
                        checked={selected.includes(row.enrollment_id)}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, row.enrollment_id]
                              : ids.filter((id) => id !== row.enrollment_id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="person-cell">
                        <StudentAvatar stid={row.stid} name={row.name} version={version} />
                        <div>
                          <b>{row.name}</b>
                          <span>Monthly tuition</span>
                        </div>
                      </div>
                    </td>
                    <td>{row.class_name}</td>
                    <td>{money(row.fee)}</td>
                    <td>
                      <span className="discount-chip">
                        <Tag size={12} />
                        {row.discount_percentage}%
                      </span>
                    </td>
                    <td>
                      <b className="table-money">
                        {money(
                          row.payment_id ? row.amount_paid : row.due_amount,
                        )}
                      </b>
                    </td>
                    <td>
                      {Number(row.discount_percentage) >= 100 ? (
                        <span className="sub-cell">No fee due</span>
                      ) : row.payment_id ? (
                        <Status value="paid" />
                      ) : (
                        <Status value="pending" />
                      )}
                    </td>
                    <td>
                      {Number(row.discount_percentage) >= 100 ? (
                        <span className="free-access-label">Free Access</span>
                      ) : !row.payment_id && (
                        <button
                          className="small-action"
                          onClick={() => pay([row.enrollment_id])}
                        >
                          Record payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !error && (
            <EmptyState
              title={
                studentFilter
                  ? "No pending payments for this student"
                  : query ? "No matching fees" : "No enrolled students yet"
              }
              detail={
                studentFilter
                  ? "This student has no outstanding class fees for the selected month."
                  : query
                  ? "Try another search."
                  : "Enroll students in an active class to see their monthly fees here."
              }
              action={
                <Button
                  kind="secondary"
                  onClick={() => setModal({ type: "go-page", page: "classes" })}
                >
                  View classes
                </Button>
              }
            />
          )
        )}
        {!error && filtered.length > 0 && (
          <Pagination count={filtered.length} page={page} setPage={setPage} />
        )}
      </div>
      {studentFilter && (
        <section className="panel data-panel payout-panel">
          <div className="report-heading">
            <div>
              <h2>Student payment history</h2>
              <p>Paid tuition records for {students.find((student) => String(student.stid) === studentFilter)?.name || "the selected student"}.</p>
            </div>
            <Button kind="secondary" icon={Download} onClick={exportHistory} disabled={Boolean(studentHistory.error) || !studentHistory.data}>
              Export filtered PDF
            </Button>
          </div>
          {studentHistory.error && <div className="error-inline">{studentHistory.error}</div>}
          <div className="history-filter-row">
            <label>Period
              <select className="month-input" value={historyPeriod} onChange={(event) => setHistoryPeriod(event.target.value)}>
                <option value="3">Last 3 months</option>
                <option value="month">Selected month</option>
                <option value="custom">Month range</option>
              </select>
            </label>
            {historyPeriod === "month" && (
              <label>Month
                <input type="month" className="month-input" max={thisMonth()} value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)} />
              </label>
            )}
            {historyPeriod === "custom" && (
              <>
                <label>From
                  <input type="month" className="month-input" max={historyTo} value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
                </label>
                <label>To
                  <input type="month" className="month-input" min={historyFrom} max={thisMonth()} value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
                </label>
              </>
            )}
          </div>
          {studentHistory.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>CLASS</th><th>FOR MONTH</th><th>PAID ON</th><th>AMOUNT</th><th>NOTES</th></tr></thead>
                <tbody>{studentHistory.data.map((row) => (
                  <tr key={row.payment_id}><td>{row.class_name}</td><td>{row.for_month}</td><td>{prettyDate(row.payment_date)}</td><td><b>{money(row.amount_paid)}</b></td><td>{row.notes || "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : !studentHistory.error && <div className="payout-empty">No payments for this student in the selected period.</div>}
          <div className="print-report">
            <header><h1>Student payment history</h1><p>{students.find((student) => String(student.stid) === studentFilter)?.name}</p><span>{historyRange[0]} to {historyRange[1]}</span></header>
            <table><thead><tr><th>Class</th><th>For month</th><th>Paid on</th><th>Amount</th><th>Notes</th></tr></thead>
              <tbody>{(studentHistory.data || []).map((row) => <tr key={row.payment_id}><td>{row.class_name}</td><td>{row.for_month}</td><td>{row.payment_date}</td><td>{money(row.amount_paid)}</td><td>{row.notes || "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      </>
      ) : paymentTab === "teachers" ? (
        <TeacherPaymentsPanel version={version} setModal={setModal} notify={notify} refresh={refresh} />
      ) : (
        <PaymentReceiptLookup version={version} notify={notify} setModal={setModal} />
      )}
    </div>
  );
}

function MakePaymentPanel({ version, students, setModal }) {
  const [query, setQuery] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [excludedFees, setExcludedFees] = useState([]);
  const { data: pendingFees, error } = useLoad(
    () => api.payments.pendingFees(),
    [version],
  );
  const matches = students.filter((student) =>
    `${student.name} ${student.rfid || ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const studentIds = new Set(selectedStudentIds);
  const selectedFees = (pendingFees || []).filter((fee) =>
    studentIds.has(fee.stid) && !excludedFees.includes(`${fee.enrollment_id}:${fee.for_month}`),
  );
  const total = selectedFees.reduce((sum, fee) => sum + Number(fee.due_amount || 0), 0);
  const toggleStudent = (stid, checked) => {
    setSelectedStudentIds((ids) => checked
      ? [...ids, stid]
      : ids.filter((id) => id !== stid));
    if (checked) {
      const enrollmentIds = new Set((pendingFees || [])
        .filter((fee) => fee.stid === stid)
        .map((fee) => `${fee.enrollment_id}:${fee.for_month}`));
      setExcludedFees((keys) => keys.filter((key) => !enrollmentIds.has(key)));
    }
  };
  const toggleFee = (fee, checked) => {
    const key = `${fee.enrollment_id}:${fee.for_month}`;
    setExcludedFees((keys) => checked
      ? keys.filter((item) => item !== key)
      : keys.includes(key) ? keys : [...keys, key]);
  };
  const makePayment = () => {
    if (!selectedFees.length) return;
    setModal({ type: "payment-batch-review", items: selectedFees });
  };
  return (
    <section className="panel data-panel make-payment-panel">
      <div className="report-heading">
        <div>
          <h2>Select students</h2>
          <p>Search by student name or RFID, then choose one or more students.</p>
        </div>
      </div>
      <div className="make-payment-search table-search">
        <Search size={16} />
        <input
          aria-label="Search students by name or RFID for payment"
          placeholder="Search student name or RFID…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="make-payment-students" aria-label="Matching students">
        {matches.length ? matches.map((student) => (
          <label className="make-payment-student" key={student.stid}>
            <input
              type="checkbox"
              checked={selectedStudentIds.includes(student.stid)}
              onChange={(event) => toggleStudent(student.stid, event.target.checked)}
            />
            <span><b>{student.name}</b><small>{student.rfid || "No RFID"}</small></span>
            <small>{(pendingFees || []).filter((fee) => fee.stid === student.stid).length} pending</small>
          </label>
        )) : <div className="make-payment-empty">No students match that name or RFID.</div>}
      </div>
      <div className="make-payment-fees-heading">
        <div><h3>Pending payments</h3><p>Earlier months appear first. Red cards are previous months.</p></div>
        <span>{selectedFees.length} selected</span>
      </div>
      {error ? <div className="error-inline">{error}</div> : selectedFees.length ? (
        <div className="make-payment-fees">
          {selectedFees.map((fee) => {
            const key = `${fee.enrollment_id}:${fee.for_month}`;
            const pastDue = fee.for_month < thisMonth();
            return (
              <label className={`make-payment-fee ${pastDue ? "pending-fee-past" : ""}`} key={key}>
                <input
                  type="checkbox"
                  checked
                  onChange={(event) => toggleFee(fee, event.target.checked)}
                  aria-label={`Include ${fee.name} ${fee.class_name} for ${fee.for_month}`}
                />
                <span className="make-payment-fee-copy">
                  <b>{fee.name}</b>
                  <span>{fee.class_name} · {new Date(`${fee.for_month}-02`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
                </span>
                <b className="make-payment-fee-amount">{money(fee.due_amount)}</b>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="make-payment-empty">
          {selectedStudentIds.length
            ? "The selected students have no pending payments."
            : "Select students to view their pending monthly payments."}
        </div>
      )}
      <div className="make-payment-footer">
        <div><span>Total amount to pay</span><b>{money(total)}</b></div>
        <Button icon={CreditCard} onClick={makePayment} disabled={!selectedFees.length}>
          Make payment
        </Button>
      </div>
    </section>
  );
}

function PaymentReceiptLookup({ version, notify, setModal }) {
  const [code, setCode] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const { data: recentReceipts, error: recentError } = useLoad(
    () => searched ? Promise.resolve([]) : api.payments.recentReceipts(),
    [version, searched],
  );
  const lookup = async (event) => {
    event.preventDefault();
    setLoading(true);
    setSearched(true);
    setError("");
    setReceipt(null);
    try {
      const result = await api.payments.receipt(code);
      if (!result) setError("No payment record was found for that receipt number.");
      else setReceipt(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="panel data-panel payment-receipt-panel">
      <div className="report-heading">
        <div><h2>Find a payment receipt</h2><p>Enter or scan the 8-digit receipt number to verify its payment details.</p></div>
      </div>
      <form className="payment-receipt-search" onSubmit={lookup}>
        <label htmlFor="payment-receipt-code">Receipt / barcode number</label>
        <div>
          <input
            id="payment-receipt-code"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            pattern="[0-9]{8}"
            placeholder="00000001"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
              setSearched(false);
              setReceipt(null);
              setError("");
            }}
          />
          <Button type="submit" disabled={loading || code.length !== 8}>
            {loading ? "Searching…" : "Check payment"}
          </Button>
        </div>
      </form>
      {searched ? (
        <div className="payment-receipt-result">
          {loading && <div className="payment-recent-empty">Searching for receipt {code}…</div>}
          {error && <div className="error-inline">{error}</div>}
          {receipt && (
            <>
              <div className="payment-receipt-summary">
                <div><span>Receipt number</span><b>{receipt.receipt_code}</b></div>
                <div><span>Paid on</span><b>{prettyDate(receipt.payment_date)} · {receipt.payment_time}</b></div>
                <div><span>Payment total</span><b>{money(receipt.total)}</b></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>STUDENT</th><th>RFID</th><th>CLASS</th><th>FOR MONTH</th><th>AMOUNT PAID</th></tr></thead>
                  <tbody>{receipt.rows.map((row) => (
                    <tr key={row.payment_id}>
                      <td><b>{row.student_name}</b></td><td>{row.rfid || "—"}</td>
                      <td>{row.class_name}</td><td>{row.for_month}</td><td><b>{money(row.amount_paid)}</b></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <PaymentReceiptActions receiptCode={receipt.receipt_code} notify={notify} />
            </>
          )}
        </div>
      ) : (
        <div className="payment-recent-receipts">
          <div className="payment-recent-heading">
            <div><h3>Recent payments</h3><p>Latest 4 receipts, summarized by total paid.</p></div>
          </div>
          {recentError && <div className="error-inline">{recentError}</div>}
          {recentReceipts?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>RECEIPT</th><th>STUDENT(S)</th><th>PAYMENT</th><th>PAID ON</th><th>CLASSES</th><th /></tr></thead>
              <tbody>{recentReceipts.map((recent) => (
                <tr key={recent.receipt_id}>
                  <td><b className="receipt-code-inline">{recent.receipt_code}</b></td>
                  <td>{recent.student_names}</td>
                  <td><b>{money(recent.total)}</b></td>
                  <td>{prettyDate(recent.payment_date)} · {recent.payment_time}</td>
                  <td>{recent.class_count}</td>
                  <td>
                    <div className="payment-recent-actions">
                      <Button kind="secondary" icon={Eye} onClick={async () => {
                        setCode(recent.receipt_code);
                        setError("");
                        setLoading(true);
                        try {
                          const result = await api.payments.receipt(recent.receipt_code);
                          if (!result) setError("No payment record was found for that receipt number.");
                          else setModal({ type: "payment-receipt-detail", receipt: result });
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setLoading(false);
                        }
                      }}>View</Button>
                      <PaymentReceiptActions receiptCode={recent.receipt_code} notify={notify} />
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          ) : !recentError && (
            <div className="payment-recent-empty">No payments have been recorded yet.</div>
          )}
        </div>
      )}
    </section>
  );
}

function TeacherPaymentsPanel({ version, setModal, notify, refresh }) {
  const [section, setSection] = useState("balances");
  const [teacherId, setTeacherId] = useState("");
  const [period, setPeriod] = useState("3");
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState(shiftMonth(thisMonth(), -2));
  const [to, setTo] = useState(thisMonth());
  const [historyPage, setHistoryPage] = useState(1);
  const [balancePage, setBalancePage] = useState(1);
  const range = period === "3"
    ? [shiftMonth(thisMonth(), -2), thisMonth()]
    : period === "month"
      ? [month, month]
      : [from, to];
  const { data: teachers } = useLoad(() => api.teachers.list(), [version]);
  const payouts = useLoad(
    () => api.payouts.list({
      tid: teacherId ? Number(teacherId) : undefined,
      start_month: range[0],
      end_month: range[1],
    }),
    [teacherId, period, month, from, to, version],
  );
  const balances = useLoad(() => api.reports.teacherBalances(), [version]);
  const exportHistory = async () => {
    try {
      const result = await api.reports.exportPDF();
      if (!result.canceled) notify("Filtered teacher payout history exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const filteredBalances = (balances.data || [])
    .filter((row) => !teacherId || row.tid === Number(teacherId))
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const paidThisMonth = (balances.data || []).reduce(
    (sum, row) => sum + Number(row.paid_out_this_month || 0),
    0,
  );
  const pendingTotal = (balances.data || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.outstanding || 0)),
    0,
  );
  return (
    <section className="panel data-panel teacher-payment-panel">
      <div className="report-heading">
        <div><h2>Teacher payments</h2><p>Review teacher balances and payout history.</p></div>
        <div className="heading-actions">
          {section === "balances" ? (
            <>
              <Button kind="secondary" icon={Download} onClick={async () => {
                try {
                  const result = await api.payouts.downloadOpeningBalanceTemplate();
                  if (!result.canceled) notify("Teacher opening balance template downloaded.");
                } catch (err) {
                  notify(err.message, "error");
                }
              }}>Excel template</Button>
              <Button kind="secondary" icon={Upload} onClick={async () => {
                try {
                  const result = await api.payouts.importOpeningBalances();
                  if (!result.canceled) {
                    notify(`${result.count} teacher opening balance${result.count === 1 ? "" : "s"} imported.`);
                    refresh();
                  }
                } catch (err) {
                  notify(err.message, "error");
                }
              }}>Import Excel</Button>
              <Button kind="secondary" icon={Plus} onClick={() => setModal({ type: "teacher-opening-balance-form" })}>Set opening balance</Button>
            </>
          ) : null}
          <Button icon={Plus} onClick={() => setModal({ type: "payout-form" })}>Record teacher payout</Button>
          {section === "history" && (
            <Button kind="secondary" icon={Download} onClick={exportHistory} disabled={!payouts.data || Boolean(payouts.error)}>Export filtered PDF</Button>
          )}
        </div>
      </div>
      <div className="report-tabs teacher-payment-tabs" role="tablist" aria-label="Teacher payment sections">
        <button type="button" role="tab" aria-selected={section === "balances"} className={section === "balances" ? "active" : ""} onClick={() => setSection("balances")}>Balances</button>
        <button type="button" role="tab" aria-selected={section === "history"} className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Payout history</button>
      </div>
      {section === "history" ? (
        <>
          <div className="history-filter-row">
            <label>Teacher
              <SearchableSelect
                value={teacherId}
                ariaLabel="Filter payout history by teacher"
                placeholder="Search a teacher…"
                options={[
                  { value: "", label: "All teachers" },
                  ...(teachers || []).map((teacher) => ({ value: String(teacher.tid), label: teacher.name })),
                ]}
                onValueChange={(value) => { setTeacherId(value); setHistoryPage(1); }}
              />
            </label>
            <label>Period
              <select className="month-input" value={period} onChange={(event) => { setPeriod(event.target.value); setHistoryPage(1); }}>
                <option value="3">Last 3 months</option>
                <option value="month">Selected month</option>
                <option value="custom">Month range</option>
              </select>
            </label>
            {period === "month" && (
              <label>Month
                <input type="month" className="month-input" max={thisMonth()} value={month} onChange={(event) => { setMonth(event.target.value); setHistoryPage(1); }} />
              </label>
            )}
            {period === "custom" && (
              <>
                <label>From
                  <input type="month" className="month-input" max={to} value={from} onChange={(event) => { setFrom(event.target.value); setHistoryPage(1); }} />
                </label>
                <label>To
                  <input type="month" className="month-input" min={from} max={thisMonth()} value={to} onChange={(event) => { setTo(event.target.value); setHistoryPage(1); }} />
                </label>
              </>
            )}
          </div>
          {payouts.error && <div className="error-inline">{payouts.error}</div>}
          <div className="report-heading compact-report-heading"><div><h2>Payout history</h2><p>{range[0]} through {range[1]}</p></div></div>
          {payouts.data?.length ? (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>TEACHER</th><th>DATE</th><th>CLASSES / MONTHS</th><th>NOTES</th><th>AMOUNT PAID</th></tr></thead>
                <tbody>{pageSlice(payouts.data, historyPage).map((row) => <tr key={row.payout_id}><td><b>{row.teacher_name}</b></td><td>{prettyDate(row.payout_date)}</td><td>{row.details || "—"}</td><td>{row.notes || "—"}</td><td><b>{money(row.amount)}</b></td></tr>)}</tbody>
              </table></div>
              <Pagination count={payouts.data.length} page={historyPage} setPage={setHistoryPage} />
            </>
          ) : !payouts.error && <div className="payout-empty">No payouts for this teacher and period.</div>}
          <div className="print-report">
            <header><h1>Teacher payout report</h1><p>{teacherId ? teachers?.find((teacher) => String(teacher.tid) === teacherId)?.name : "All teachers"}</p><span>{range[0]} to {range[1]}</span></header>
            <table><thead><tr><th>Teacher</th><th>Date</th><th>Classes / months</th><th>Notes</th><th>Amount</th></tr></thead>
              <tbody>{(payouts.data || []).map((row) => <tr key={row.payout_id}><td>{row.teacher_name}</td><td>{row.payout_date}</td><td>{row.details || "—"}</td><td>{row.notes || "—"}</td><td>{money(row.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="payment-summary-grid teacher-payment-summary-grid">
            <div className="payment-summary panel">
              <div className="payment-summary-icon paid-icon"><CheckCheck size={18} /></div>
              <span>Teacher payments this month</span>
              <b>{balances.data ? money(paidThisMonth) : "—"}</b>
              <small>Payouts recorded in {thisMonth()}</small>
            </div>
            <div className="payment-summary panel">
              <div className="payment-summary-icon due-icon"><Clock3 size={18} /></div>
              <span>Pending teacher payments</span>
              <b>{balances.data ? money(pendingTotal) : "—"}</b>
              <small>Total outstanding balance for all teachers</small>
            </div>
          </div>
          <div className="history-filter-row">
            <label>Teacher
              <SearchableSelect
                value={teacherId}
                ariaLabel="Filter teacher balances by teacher"
                placeholder="Search a teacher…"
                options={[
                  { value: "", label: "All teachers" },
                  ...(teachers || []).map((teacher) => ({ value: String(teacher.tid), label: teacher.name })),
                ]}
                onValueChange={(value) => { setTeacherId(value); setBalancePage(1); }}
              />
            </label>
          </div>
          <div className="report-heading compact-report-heading"><div><h2>Teacher balances</h2><p>Opening balance is prior unpaid teacher earnings. New collected student fees add the teacher’s commission; payouts reduce the total owed.</p></div></div>
          {balances.error && <div className="error-inline">{balances.error}</div>}
          {filteredBalances.length ? (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>TEACHER</th><th>OPENING BALANCE</th><th>EARNED TO DATE</th><th>PAID THIS MONTH</th><th>PENDING BALANCE</th></tr></thead>
                <tbody>{pageSlice(filteredBalances, balancePage).map((row) => {
                  const outstanding = Number(row.outstanding);
                  return (
                    <tr key={row.tid}><td><b>{row.name}</b></td><td>{money(row.opening_balance)}</td><td>{money(row.earned)}</td><td><b className="teacher-paid-month">{money(row.paid_out_this_month)}</b></td><td><b className={`teacher-balance-badge ${outstanding > 0 ? "teacher-balance-pending" : "teacher-balance-settled"}`}>{money(outstanding)}</b></td></tr>
                  );
                })}</tbody>
              </table></div>
              <Pagination count={filteredBalances.length} page={balancePage} setPage={setBalancePage} />
            </>
          ) : !balances.error && <div className="payout-empty">No teacher balance records found.</div>}
        </>
      )}
    </section>
  );
}

function ReportsPage({ version, setModal, notify, user }) {
  const [month, setMonth] = useState(thisMonth());
  const [summaryDate, setSummaryDate] = useState(today());
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [classReportBusy, setClassReportBusy] = useState(false);
  const [reportSection, setReportSection] = useState("students");
  const [sessionStartDate, setSessionStartDate] = useState(today());
  const [sessionEndDate, setSessionEndDate] = useState(today());
  const [sessionTeacherId, setSessionTeacherId] = useState("");
  const [reportStudentId, setReportStudentId] = useState("");
  const [historyYear, setHistoryYear] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
  const [historyClass, setHistoryClass] = useState("");
  const [classQuery, setClassQuery] = useState("");
  const [balanceQuery, setBalanceQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [payoutQuery, setPayoutQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [classPage, setClassPage] = useState(1);
  const [balancePage, setBalancePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [payoutPage, setPayoutPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);
  const currentReportMonth = thisMonth();
  const earnings = useLoad(() => api.reports.classEarnings(month), [month, version]);
  const todayEarnings = useLoad(
    () => api.reports.classEarnings(currentReportMonth),
    [currentReportMonth, version],
  );
  const balances = useLoad(() => api.reports.teacherBalances(), [version]);
  const history = useLoad(() => api.reports.paymentRecords(), [version]);
  const payouts = useLoad(() => api.payouts.list(), [version]);
  const pendingRecords = useLoad(() => api.reports.pendingPayments(month), [month, version]);
  const classes = useLoad(() => api.classes.list(), [version]);
  const students = useLoad(() => api.students.list(), [version]);
  const teachers = useLoad(() => api.teachers.list(), [version]);
  const sessionReport = useLoad(
    () => api.reports.sessions({
      start_date: sessionStartDate,
      end_date: sessionEndDate,
      tid: sessionTeacherId ? Number(sessionTeacherId) : undefined,
    }),
    [sessionStartDate, sessionEndDate, sessionTeacherId, version],
  );
  const attendance = useLoad(
    () => api.reports.studentAttendance({
      stid: reportStudentId ? Number(reportStudentId) : undefined,
      start_month: month,
      end_month: month,
    }),
    [reportStudentId, month, version],
  );
  const data = earnings.data || [];
  const filteredClasses = data.filter((row) =>
    `${row.class_name} ${row.teacher_name}`.toLowerCase().includes(classQuery.toLowerCase()),
  );
  const filteredBalances = (balances.data || []).filter((row) =>
    row.name.toLowerCase().includes(balanceQuery.toLowerCase()),
  );
  const selectedHistory = (history.data || []).filter((row) =>
    (!historyYear || row.for_month.slice(0, 4) === historyYear)
    && (!historyMonth || row.for_month === historyMonth)
    && (!historyClass || row.class_id === Number(historyClass))
    && (!reportStudentId || row.stid === Number(reportStudentId)),
  );
  const filteredHistory = selectedHistory.filter((row) =>
    `${row.student_name} ${row.rfid || ""} ${row.class_name} ${row.teacher_name} ${row.notes || ""}`
      .toLowerCase().includes(historyQuery.toLowerCase()),
  );
  const filteredPayouts = (payouts.data || []).filter((row) =>
    `${row.teacher_name} ${row.details || ""} ${row.notes || ""} ${row.payout_date}`
      .toLowerCase().includes(payoutQuery.toLowerCase()),
  );
  const filteredPending = (pendingRecords.data || []).filter((row) =>
    `${row.student_name} ${row.rfid || ""} ${row.class_name} ${row.teacher_name}`
      .toLowerCase().includes(pendingQuery.toLowerCase())
      && (!reportStudentId || row.stid === Number(reportStudentId)),
  );
  const years = [...new Set((history.data || []).map((row) => row.for_month.slice(0, 4)))].sort().reverse();
  const collected = data.reduce((sum, row) => sum + Number(row.collected), 0);
  const pending = data.reduce((sum, row) => sum + Number(row.pending), 0);
  const teacherTotal = data.reduce((sum, row) => sum + Number(row.teacher_earnings), 0);
  const orgTotal = data.reduce((sum, row) => sum + Number(row.org_earnings), 0);
  const pendingTeacher = data.reduce((sum, row) => sum + Number(row.pending_teacher), 0);
  const pendingOrg = data.reduce((sum, row) => sum + Number(row.pending_org), 0);
  const totalPendingTeacher = (balances.data || []).reduce(
    (sum, row) => sum + Number(row.outstanding),
    0,
  );
  const paidToTeachers = (payouts.data || []).reduce(
    (sum, row) => sum + (row.payout_date.slice(0, 7) === month ? Number(row.amount) : 0),
    0,
  );
  const todayPendingOrg = (todayEarnings.data || []).reduce(
    (sum, row) => sum + Number(row.pending_org),
    0,
  );
  const exportPdf = async () => {
    try {
      const result = await api.reports.exportPDF();
      if (!result.canceled) notify("Report exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const exportDailySummary = async () => {
    if (!summaryDate || summaryBusy) return;
    setSummaryBusy(true);
    try {
      const result = await api.reports.exportDailySummaryPDF(summaryDate);
      if (!result.canceled) notify("Daily summary report exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSummaryBusy(false);
    }
  };
  const exportClassPaymentReport = async () => {
    if (classReportBusy) return;
    setClassReportBusy(true);
    try {
      const result = await api.reports.exportClassPaymentPDF(month.slice(0, 4));
      if (!result.canceled) notify("Annual class payment register exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setClassReportBusy(false);
    }
  };
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="UNDERSTAND YOUR NUMBERS"
        title="Reports"
        subtitle="Review student fees, outstanding payments and every teacher payout."
        action={
          <div className="heading-actions">
            <input
              type="month"
              className="month-input"
              aria-label="Report month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <Button
              kind="secondary"
              icon={Download}
              onClick={exportPdf}
              disabled={!history.data || !payouts.data || !pendingRecords.data}
            >
              Export PDF
            </Button>
          </div>
        }
      />
      <div className="stats-grid report-overview-stats">
        <div className="stat-card">
          <div className="stat-icon"><Activity size={18} /></div>
          <div className="stat-label">Institute earnings</div>
          <div className="stat-value">{earnings.data ? money(orgTotal) : "—"}</div>
          <div className="stat-foot">Institute share collected for {month}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Wallet size={18} /></div>
          <div className="stat-label">Total pending teacher payments up to today</div>
          <div className="stat-value">{balances.data ? money(totalPendingTeacher) : "—"}</div>
          <div className="stat-foot">Outstanding teacher balance across all classes</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><CreditCard size={18} /></div>
          <div className="stat-label">Teachers Payouts</div>
          <div className="stat-value">{payouts.data ? money(paidToTeachers) : "—"}</div>
          <div className="stat-foot">Payouts recorded during {month}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><CalendarDays size={18} /></div>
          <div className="stat-label">Pending payments today</div>
          <div className="stat-value">{todayEarnings.data ? money(todayPendingOrg) : "—"}</div>
          <div className="stat-foot">Institute share outstanding as of {prettyDate(today())}</div>
        </div>
      </div>
      {earnings.error && <div className="error-inline">{earnings.error}</div>}
      {balances.error && <div className="error-inline">{balances.error}</div>}
      {todayEarnings.error && <div className="error-inline">{todayEarnings.error}</div>}
      {payouts.error && <div className="error-inline">{payouts.error}</div>}
      <section className="daily-summary-launch">
        <div className="daily-summary-copy">
          <div className="daily-summary-icon"><CalendarDays size={24} /></div>
          <div>
            <h2>Daily summary report</h2>
            <p>Payments received, teacher payouts, student totals and session attendance in one PDF.</p>
          </div>
        </div>
        <div className="daily-summary-actions">
          <label>
            <span>Report date</span>
            <input type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} />
          </label>
          <Button className="daily-summary-button" icon={Download} onClick={exportDailySummary} disabled={!summaryDate || summaryBusy}>
            {summaryBusy ? "Preparing report…" : `${summaryDate === today() ? "Today" : prettyDate(summaryDate)} summary PDF`}
          </Button>
        </div>
      </section>
      <div className="report-tabs" role="tablist" aria-label="Report sections">
        <button className={reportSection === "students" ? "active" : ""} onClick={() => setReportSection("students")}>Student reports</button>
        <button className={reportSection === "teachers" ? "active" : ""} onClick={() => setReportSection("teachers")}>Teacher reports</button>
        <button className={reportSection === "classes" ? "active" : ""} onClick={() => setReportSection("classes")}>Class reports</button>
        <button className={reportSection === "sessions" ? "active" : ""} onClick={() => setReportSection("sessions")}>Sessions</button>
      </div>
      {reportSection === "sessions" && (
        <section className="panel data-panel payout-panel">
          <div className="report-heading">
            <div><h2>Session report</h2><p>Sessions held, teachers, and attendance for the selected date or date range.</p></div>
          </div>
          <div className="history-filter-row">
            <label>From date
              <input type="date" className="month-input" value={sessionStartDate} max={sessionEndDate} onChange={(event) => { setSessionStartDate(event.target.value); setSessionPage(1); }} />
            </label>
            <label>To date
              <input type="date" className="month-input" value={sessionEndDate} min={sessionStartDate} onChange={(event) => { setSessionEndDate(event.target.value); setSessionPage(1); }} />
            </label>
            <label>Teacher
              <SearchableSelect
                value={sessionTeacherId}
                ariaLabel="Filter sessions by teacher"
                placeholder="Search a teacher…"
                options={[
                  { value: "", label: "All teachers" },
                  ...(teachers.data || []).map((teacher) => ({ value: String(teacher.tid), label: teacher.name })),
                ]}
                onValueChange={(value) => { setSessionTeacherId(value); setSessionPage(1); }}
              />
            </label>
          </div>
          {sessionReport.error && <div className="error-inline">{sessionReport.error}</div>}
          {sessionReport.data?.length ? (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>DATE</th><th>CLASS</th><th>TIME</th><th>TEACHER</th><th>STUDENTS PRESENT</th><th>STATUS</th></tr></thead>
                <tbody>{pageSlice(sessionReport.data, sessionPage).map((row) => (
                  <tr key={row.session_id}>
                    <td>{prettyDate(row.session_date)}</td>
                    <td><b>{row.class_name}</b></td>
                    <td>{[row.start_time, row.end_time].filter(Boolean).join(" – ") || "Not set"}</td>
                    <td>{row.teacher_name}</td>
                    <td><b>{row.present_count} / {row.enrolled_count}</b></td>
                    <td><Status value={row.status} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pagination count={sessionReport.data.length} page={sessionPage} setPage={setSessionPage} />
            </>
          ) : !sessionReport.error && <div className="payout-empty">No sessions found for the selected date range and teacher.</div>}
        </section>
      )}
      {reportSection === "classes" && (
      <>
      <div className="report-metrics">
        <div><span>Total collected</span><b>{money(collected)}</b><small>Payments recorded for {month}</small></div>
        <div><span>Outstanding tuition</span><b>{money(pending)}</b><small>After individual student discounts</small></div>
        <div><span>Teacher share</span><b>{money(teacherTotal)}</b><small>{money(pendingTeacher)} share of outstanding fees</small></div>
        <div><span>Organization share</span><b>{money(orgTotal)}</b><small>{money(pendingOrg)} share of outstanding fees</small></div>
      </div>
      <div className="panel data-panel report-table">
        <div className="report-heading">
          <div><h2>Class earnings</h2><p>Per-class breakdown for {month}</p></div>
          <Button kind="secondary" icon={Download} onClick={exportClassPaymentReport} disabled={classReportBusy}>
            {classReportBusy ? "Preparing PDF…" : `Print ${month.slice(0, 4)} Payment Sheets`}
          </Button>
        </div>
        <TableToolbar count={filteredClasses.length} placeholder="Search class or teacher…" query={classQuery} setQuery={(value) => { setClassQuery(value); setClassPage(1); }} />
        {filteredClasses.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>CLASS &amp; TEACHER</th><th>ENROLLED</th><th>PAID / DUE</th><th>COLLECTED</th><th>OUTSTANDING</th><th>TEACHER EARNED / DUE</th><th>ORG. EARNED / DUE</th></tr></thead>
                <tbody>{pageSlice(filteredClasses, classPage).map((row) => (
                  <tr key={row.class_id}>
                    <td><b>{row.class_name}</b><div className="sub-cell">{row.teacher_name} · {row.teacher_commission_percentage}% commission</div></td>
                    <td>{row.enrolled_count}</td>
                    <td>{row.paid_students} paid · {row.not_paid_students} due</td>
                    <td><b className="table-money">{money(row.collected)}</b></td>
                    <td>{money(row.pending)}</td>
                    <td>{money(row.teacher_earnings)}<div className="sub-cell">{money(row.pending_teacher)} pending</div></td>
                    <td>{money(row.org_earnings)}<div className="sub-cell">{money(row.pending_org)} pending</div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pagination count={filteredClasses.length} page={classPage} setPage={setClassPage} />
          </>
        ) : !earnings.error && <EmptyState title={classQuery ? "No matching classes" : "Your reports will appear here"} detail={classQuery ? "Try a different class or teacher name." : "Create a class and enrol students to start tracking monthly earnings."} />}
      </div>
      </>
      )}
      {reportSection === "teachers" && (
      <>
      <section className="panel data-panel payout-panel">
        <div className="report-heading">
          <div><h2>Teacher payout balances</h2><p>Total earned from recorded tuition minus all payouts to date</p></div>
          <Button kind="secondary" icon={Plus} onClick={() => setModal({ type: "payout-form" })}>Add payout</Button>
        </div>
        <TableToolbar count={filteredBalances.length} placeholder="Search teacher balances…" query={balanceQuery} setQuery={(value) => { setBalanceQuery(value); setBalancePage(1); }} />
        {filteredBalances.length ? (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>TEACHER</th><th>OPENING BALANCE</th><th>EARNED TO DATE</th><th>PAID OUT</th><th>REMAINING BALANCE</th></tr></thead>
              <tbody>{pageSlice(filteredBalances, balancePage).map((row) => <tr key={row.tid}><td><b>{row.name}</b></td><td>{money(row.opening_balance)}</td><td>{money(row.earned)}</td><td>{money(row.paid_out)}</td><td><b>{money(row.outstanding)}</b></td></tr>)}</tbody>
            </table></div>
            <Pagination count={filteredBalances.length} page={balancePage} setPage={setBalancePage} />
          </>
        ) : !balances.error && <div className="payout-empty">{balanceQuery ? "No teacher balances match this search." : "Teacher balances will appear after you add a teacher and class."}</div>}
      </section>
      <section className="panel data-panel payout-panel">
        <div className="report-heading"><div><h2>Teacher payout records</h2><p>Recorded payouts and the classes/months they cover.</p></div></div>
        <TableToolbar count={filteredPayouts.length} placeholder="Search teacher payouts…" query={payoutQuery} setQuery={(value) => { setPayoutQuery(value); setPayoutPage(1); }} />
        {filteredPayouts.length ? (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>TEACHER</th><th>DATE</th><th>CLASSES / MONTHS</th><th>NOTES</th><th>AMOUNT</th></tr></thead>
              <tbody>{pageSlice(filteredPayouts, payoutPage).map((row) => (
                <tr key={row.payout_id}><td><b>{row.teacher_name}</b></td><td>{prettyDate(row.payout_date)}</td><td>{row.details || "—"}</td><td>{row.notes || "—"}</td><td><b>{money(row.amount)}</b></td></tr>
              ))}</tbody>
            </table></div>
            <Pagination count={filteredPayouts.length} page={payoutPage} setPage={setPayoutPage} />
          </>
        ) : !payouts.error && <div className="payout-empty">No teacher payouts recorded yet.</div>}
      </section>
      </>
      )}
      {reportSection === "students" && (
      <>
      <section className="panel data-panel payout-panel">
        <div className="report-heading">
          <div><h2>Student reports</h2><p>Review attendance, paid tuition history and pending fees for {month}.</p></div>
          <SearchableSelect
            value={reportStudentId}
            ariaLabel="Filter student reports"
            placeholder="Search student…"
            options={[
              { value: "", label: "All students" },
              ...(students.data || []).map((student) => ({ value: String(student.stid), label: student.name })),
            ]}
            onValueChange={setReportStudentId}
          />
        </div>
        <div className="report-heading compact-report-heading"><div><h2>Student payment records</h2><p>Filter payment history by month, year and class.</p></div></div>
        {history.error && <div className="error-inline">{history.error}</div>}
        <TableToolbar count={filteredHistory.length} placeholder="Search student, RFID, class or teacher…" query={historyQuery} setQuery={(value) => { setHistoryQuery(value); setHistoryPage(1); }}>
          <SearchableSelect className="toolbar-search-select" ariaLabel="Filter payment records by year" value={historyYear} options={[{ value: "", label: "All years" }, ...years.map((year) => ({ value: year, label: year }))]} onValueChange={(value) => { setHistoryYear(value); setHistoryPage(1); }} />
          <input type="month" max={thisMonth()} className="month-input" aria-label="Filter payment records by month" value={historyMonth} onChange={(event) => { setHistoryMonth(event.target.value); setHistoryPage(1); }} />
          <SearchableSelect className="toolbar-search-select" ariaLabel="Filter payment records by class" value={historyClass} options={[{ value: "", label: "All classes" }, ...(classes.data || []).map((item) => ({ value: String(item.class_id), label: item.class_name }))]} onValueChange={(value) => { setHistoryClass(value); setHistoryPage(1); }} />
        </TableToolbar>
        {filteredHistory.length ? <>
          <div className="table-wrap"><table>
            <thead><tr><th>STUDENT</th><th>CLASS</th><th>TEACHER</th><th>FOR MONTH</th><th>PAYMENT DATE</th><th>AMOUNT</th><th>NOTES</th></tr></thead>
            <tbody>{pageSlice(filteredHistory, historyPage).map((row) => <tr key={row.payment_id}>
              <td><b>{row.student_name}</b>{row.rfid && <div className="sub-cell">RFID {row.rfid}</div>}</td>
              <td>{row.class_name}</td><td>{row.teacher_name}</td><td>{row.for_month}</td><td>{prettyDate(row.payment_date)}</td><td><b>{money(row.amount_paid)}</b></td><td>{row.notes || "—"}</td>
            </tr>)}</tbody>
          </table></div>
          <Pagination count={filteredHistory.length} page={historyPage} setPage={setHistoryPage} />
        </> : !history.error && <div className="payout-empty">No student payments match these filters.</div>}
      </section>
      <section className="panel data-panel payout-panel">
        <div className="report-heading"><div><h2>Pending payments · {month}</h2><p>Outstanding student fees, always available at the end of the report.</p></div></div>
        {pendingRecords.error && <div className="error-inline">{pendingRecords.error}</div>}
        <TableToolbar count={filteredPending.length} placeholder="Search pending students, RFID or class…" query={pendingQuery} setQuery={(value) => { setPendingQuery(value); setPendingPage(1); }} />
        {filteredPending.length ? <>
          <div className="table-wrap"><table>
            <thead><tr><th>STUDENT</th><th>CLASS</th><th>TEACHER</th><th>MONTH</th><th>AMOUNT DUE</th></tr></thead>
            <tbody>{pageSlice(filteredPending, pendingPage).map((row) => <tr key={row.enrollment_id}><td><b>{row.student_name}</b>{row.rfid && <div className="sub-cell">RFID {row.rfid}</div>}</td><td>{row.class_name}</td><td>{row.teacher_name}</td><td>{month}</td><td><b className="pending-amount">{money(row.amount_due)}</b></td></tr>)}</tbody>
          </table></div>
          <Pagination count={filteredPending.length} page={pendingPage} setPage={setPendingPage} />
        </> : !pendingRecords.error && <div className="payout-empty">{pendingQuery ? "No pending payments match this search." : `No pending payments for ${month}.`}</div>}
      </section>
      <section className="panel data-panel payout-panel">
        <div className="report-heading"><div><h2>Student attendance</h2><p>Present and absent records during {month}.</p></div></div>
        {attendance.error && <div className="error-inline">{attendance.error}</div>}
        {attendance.data?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>STUDENT</th><th>CLASS</th><th>DATE</th><th>ATTENDANCE</th></tr></thead>
            <tbody>{attendance.data.map((row) => (
              <tr key={row.attendance_id}><td><b>{row.student_name}</b></td><td>{row.class_name}</td><td>{prettyDate(row.session_date)}</td><td><Status value={row.status} /></td></tr>
            ))}</tbody>
          </table></div>
        ) : !attendance.error && <div className="payout-empty">No attendance records found for this month.</div>}
      </section>
      </>
      )}
      <div className="print-report">
        <header><h1>{user.organization}</h1><p>Tuition payment and teacher payout report</p><span>Generated {prettyDate(today())} · Report month {month}</span></header>
        <h2>Student payment records</h2>
        <table><thead><tr><th>Student</th><th>Class</th><th>Teacher</th><th>For month</th><th>Payment date</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>{filteredHistory.map((row) => <tr key={row.payment_id}><td>{row.student_name}</td><td>{row.class_name}</td><td>{row.teacher_name}</td><td>{row.for_month}</td><td>{row.payment_date}</td><td>{money(row.amount_paid)}</td><td>{row.notes || "—"}</td></tr>)}</tbody>
        </table>
        <h2>Teacher payout records</h2>
        <table><thead><tr><th>Teacher</th><th>Date</th><th>Classes / months</th><th>Notes</th><th>Amount</th></tr></thead>
          <tbody>{filteredPayouts.map((row) => <tr key={row.payout_id}><td>{row.teacher_name}</td><td>{row.payout_date}</td><td>{row.details || "—"}</td><td>{row.notes || "—"}</td><td>{money(row.amount)}</td></tr>)}</tbody>
        </table>
        <h2>Pending payments for {month}</h2>
        <table><thead><tr><th>Student</th><th>Class</th><th>Teacher</th><th>Amount due</th></tr></thead>
          <tbody>{filteredPending.map((row) => <tr key={row.enrollment_id}><td>{row.student_name}</td><td>{row.class_name}</td><td>{row.teacher_name}</td><td>{money(row.amount_due)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsPage({ user, setUser, notify, refresh }) {
  const { data, error } = useLoad(() => api.settings.organization(), []);
  const [form, setForm] = useState(null);
  const [imageDirectory, setImageDirectory] = useState("");
  const [localBackupDirectory, setLocalBackupDirectory] = useState("");
  const [backupDirectoryBusy, setBackupDirectoryBusy] = useState(false);
  const [driveData, setDriveData] = useState(null);
  const [driveForm, setDriveForm] = useState({
    googleClientId: "",
    googleClientSecret: "",
    autoEnabled: true,
    weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), ["15:00"]])),
    retention: "30",
    missedRecovery: true,
    recoveryPassphrase: "",
    recoveryPassphraseConfirm: ""
  });
  const [backupTimeDrafts, setBackupTimeDrafts] = useState({});
  const [driveBusy, setDriveBusy] = useState("");
  const [driveBackups, setDriveBackups] = useState(null);
  useEffect(() => {
    if (data) {
      setForm(data);
      setImageDirectory(data.image_directory || "");
    }
  }, [data]);
  const [busy, setBusy] = useState(false);
  const [imageDirectoryBusy, setImageDirectoryBusy] = useState(false);
  const loadDriveSettings = useCallback(async () => {
    const result = await api.backup.getSettings();
    setDriveData(result);
    setDriveForm((current) => ({
      ...current,
      googleClientId: result.settings.googleClientId || "",
      googleClientSecret: "",
      autoEnabled: result.settings.autoEnabled,
      weeklySchedule: result.settings.weeklySchedule,
      retention: result.settings.retention,
      missedRecovery: result.settings.missedRecovery
    }));
    setLocalBackupDirectory(result.settings.localBackupDirectory || "");
  }, []);
  useEffect(() => {
    loadDriveSettings().catch((err) => notify(err.message, "error"));
  }, [loadDriveSettings, notify]);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.settings.saveOrganization(form);
      setUser({ ...user, organization: form.name });
      notify("Organization and payment due day saved.");
      refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const backup = async () => {
    try {
      const result = await api.backup.create();
      if (!result.canceled) notify(`Backup saved to ${result.path}`);
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const restore = async () => {
    try {
      const result = await api.backup.restore();
      if (result.restored) {
        notify("Backup restored. Refreshing your workspace…");
        window.location.reload();
      }
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const saveDriveSettings = async (event) => {
    event.preventDefault();
    if (driveForm.recoveryPassphrase !== driveForm.recoveryPassphraseConfirm) {
      notify("The recovery passphrases do not match.", "error");
      return;
    }
    setDriveBusy("save");
    try {
      await api.backup.saveSettings(driveForm);
      setDriveForm((current) => ({
        ...current,
        googleClientSecret: "",
        recoveryPassphrase: "",
        recoveryPassphraseConfirm: ""
      }));
      await loadDriveSettings();
      notify("Automatic backup schedule saved.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const connectDrive = async () => {
    setDriveBusy("connect");
    try {
      const result = await api.backup.googleConnect();
      await loadDriveSettings();
      notify(`Google Drive connected${result.email ? ` as ${result.email}` : ""}.`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const disconnectDrive = async () => {
    setDriveBusy("disconnect");
    try {
      await api.backup.googleDisconnect();
      await loadDriveSettings();
      setDriveBackups(null);
      notify("Google Drive disconnected.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const cloudBackupNow = async () => {
    setDriveBusy("upload");
    try {
      await api.backup.googleUpload();
      setDriveBackups(null);
      await loadDriveSettings();
      notify("Encrypted database backup uploaded to Google Drive.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const loadDriveBackups = async () => {
    setDriveBusy("list");
    try {
      setDriveBackups(await api.backup.googleList());
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const restoreDriveBackup = async (fileId) => {
    setDriveBusy("restore");
    try {
      const result = await api.backup.googleRestore(fileId);
      if (result.restored) {
        notify(`Backup restored. Safety copy retained at ${result.safetyCopy}. Sign in with an account from the backup.`);
        window.setTimeout(() => window.location.reload(), 3000);
      }
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDriveBusy("");
    }
  };
  const chooseImageDirectory = async () => {
    try {
      const result = await api.images.chooseDirectory(imageDirectory);
      if (!result.canceled) setImageDirectory(result.directory);
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const saveImageDirectory = async () => {
    setImageDirectoryBusy(true);
    try {
      const directory = await api.settings.saveImageDirectory(imageDirectory);
      setImageDirectory(directory);
      setForm((current) => ({ ...current, image_directory: directory }));
      notify("Student photo folder updated. Existing photos were moved.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setImageDirectoryBusy(false);
    }
  };
  const chooseLocalBackupDirectory = async () => {
    try {
      const result = await api.backup.chooseDirectory(localBackupDirectory);
      if (!result.canceled) setLocalBackupDirectory(result.directory);
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const saveLocalBackupDirectory = async () => {
    setBackupDirectoryBusy(true);
    try {
      const directory = await api.backup.saveDirectory(localBackupDirectory);
      setLocalBackupDirectory(directory);
      notify("Automatic local backup folder saved.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBackupDirectoryBusy(false);
    }
  };
  const addBackupTime = (day) => {
    const time = backupTimeDrafts[day] || "";
    if (!time || driveForm.weeklySchedule[day]?.includes(time)) return;
    setDriveForm((current) => ({
      ...current,
      weeklySchedule: {
        ...current.weeklySchedule,
        [day]: [...(current.weeklySchedule[day] || []), time].sort()
      }
    }));
    setBackupTimeDrafts((current) => ({ ...current, [day]: "" }));
  };
  const removeBackupTime = (day, time) => {
    setDriveForm((current) => ({
      ...current,
      weeklySchedule: {
        ...current.weeklySchedule,
        [day]: current.weeklySchedule[day].filter((item) => item !== time)
      }
    }));
  };
  const applyMondayScheduleToAllDays = () => {
    const mondayTimes = driveForm.weeklySchedule["1"] || [];
    setDriveForm((current) => ({
      ...current,
      weeklySchedule: Object.fromEntries(BACKUP_WEEKDAYS.map(({ key }) => [key, [...mondayTimes]]))
    }));
  };
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="Settings"
        subtitle="Manage your tuition centre details and protect your records."
      />
      <div className="settings-grid">
        <section className="panel settings-card organization-settings-card">
          <div className="settings-card-heading">
            <div className="settings-icon">
              <GraduationCap size={19} />
            </div>
            <div>
              <h2>Organization details</h2>
              <p>Shown throughout your workspace</p>
            </div>
          </div>
          {error && <div className="error-inline">{error}</div>}
          {form && (
            <form onSubmit={save} className="settings-form">
              <Field
                label="Organization name"
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Your tuition centre"
              />
              <Field
                label="Contact number"
                value={form.contact || ""}
                onChange={(event) =>
                  setForm({ ...form, contact: event.target.value })
                }
                placeholder="Optional"
              />
              <div className="due-date-settings">
                <div>
                  <b>Student payment due day</b>
                  <span>Set one day from 1 to 31. Unpaid students receive a yellow attendance warning on or after that day each month; attendance is never blocked.</span>
                </div>
                <Field label="Due day of each month">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    inputMode="numeric"
                    placeholder="For example, 10"
                    value={form.payment_due_day ?? ""}
                    onChange={(event) => setForm({ ...form, payment_due_day: event.target.value })}
                  />
                </Field>
                <small>For months shorter than the selected day, the due date is the last day of that month. Leave blank to turn off overdue warnings.</small>
              </div>
              <div className="settings-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          )}
        </section>
        <section className="panel settings-card photo-storage-card">
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-purple">
              <Users size={19} />
            </div>
            <div>
              <h2>Student photo storage</h2>
              <p>Choose where student photos are stored on this computer.</p>
            </div>
          </div>
          <div className="settings-form">
            <Field label="Image folder" required>
              <div className="directory-picker">
                <input readOnly value={imageDirectory} placeholder="Choose a local folder" />
                <Button kind="secondary" type="button" onClick={chooseImageDirectory} disabled={imageDirectoryBusy}>
                  Choose folder
                </Button>
              </div>
              <small>Changing this location moves existing student photos. Photos are stored outside the database and are not included in backups.</small>
            </Field>
            <div className="settings-actions">
              <Button onClick={saveImageDirectory} disabled={imageDirectoryBusy || !imageDirectory}>
                {imageDirectoryBusy ? "Moving photos…" : "Save photo location"}
              </Button>
            </div>
          </div>
        </section>
        <section className="panel settings-card backup-restore-card">
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-green">
              <ShieldCheck size={19} />
            </div>
            <div>
              <h2>Backup &amp; restore</h2>
              <p>Your records belong to you. Keep a copy somewhere safe.</p>
            </div>
          </div>
          <div className="settings-form">
            <Field label="Automatic local backup folder" required>
              <div className="directory-picker">
                <input readOnly value={localBackupDirectory} placeholder="Choose a local folder" />
                <Button kind="secondary" type="button" onClick={chooseLocalBackupDirectory} disabled={backupDirectoryBusy}>
                  Choose folder
                </Button>
              </div>
              <small>Scheduled backups are saved here, even when Google Drive is not connected.</small>
            </Field>
            <div className="settings-actions">
              <Button type="button" onClick={saveLocalBackupDirectory} disabled={backupDirectoryBusy || !localBackupDirectory}>
                {backupDirectoryBusy ? "Saving…" : "Save backup folder"}
              </Button>
            </div>
          </div>
          <div className="backup-info">
            <div>
              <Download size={17} />
              <div>
                <b>Download a backup</b>
                <span>Save a SQLite copy to a folder you choose. Student photos are not included.</span>
              </div>
            </div>
            <Button kind="secondary" icon={ArrowDownToLine} onClick={backup}>
              Back up now
            </Button>
          </div>
          <div className="backup-info">
            <div>
              <ArrowDownToLine size={17} />
              <div>
                <b>Restore a backup</b>
                <span>
                  Restore a verified database copy. A safety copy is made first.
                </span>
              </div>
            </div>
            <Button kind="secondary" onClick={restore}>
              Choose file
            </Button>
          </div>
        </section>
        <section className="panel settings-card drive-settings">
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-purple">
              <ShieldCheck size={19} />
            </div>
            <div>
              <h2>Automatic backup schedule</h2>
              <p>Schedule local backups and, when connected, encrypted copies in your Google Drive. Student images are not included.</p>
            </div>
          </div>
          <div className={`drive-connection ${driveData?.connected?.connected ? "is-connected" : ""}`}>
            <div>
              <b>{driveData?.connected?.connected ? "Connected to Google Drive" : "Google Drive is not connected"}</b>
              <span>{driveData?.connected?.connected ? driveData.connected.email || "Google account connected" : "Connect the Google account that should own this tuition centre’s backups."}</span>
            </div>
            {driveData?.connected?.connected ? (
              <Button kind="secondary" type="button" onClick={disconnectDrive} disabled={Boolean(driveBusy)}>
                {driveBusy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <Button type="button" onClick={connectDrive} disabled={Boolean(driveBusy) || !driveForm.googleClientId || driveForm.googleClientId !== driveData?.settings.googleClientId || Boolean(driveForm.googleClientSecret) || !driveData?.settings.googleClientSecretConfigured || !driveData?.passphraseConfigured}>
                {driveBusy === "connect" ? "Connecting…" : "Connect Google Drive"}
              </Button>
            )}
          </div>
          <form onSubmit={saveDriveSettings} className="settings-form">
            <div className="form-two">
              <Field label="Google OAuth Client ID" required>
                <input
                  type="text"
                  autoComplete="off"
                  value={driveForm.googleClientId}
                  placeholder="xxxx.apps.googleusercontent.com"
                  onChange={(event) => setDriveForm({ ...driveForm, googleClientId: event.target.value })}
                />
                <small>Copy this from Google Cloud Console → Clients.</small>
              </Field>
              <Field label="Google OAuth Client Secret" required={!driveData?.settings.googleClientSecretConfigured}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={driveForm.googleClientSecret}
                  placeholder={driveData?.settings.googleClientSecretConfigured ? "Saved securely; leave blank to keep" : "Enter the client secret"}
                  onChange={(event) => setDriveForm({ ...driveForm, googleClientSecret: event.target.value })}
                />
                <small>{driveData?.settings.googleClientSecretConfigured ? "Stored with operating-system protection and never displayed after saving." : "Copy the matching secret from Google Cloud Console → Clients."}</small>
              </Field>
            </div>
            <div className="backup-preferences">
              <label className="backup-toggle">
                <input type="checkbox" checked={driveForm.autoEnabled} onChange={(event) => setDriveForm({ ...driveForm, autoEnabled: event.target.checked })} />
                <span>Enable scheduled backups</span>
              </label>
              <label className="backup-toggle">
                <input type="checkbox" checked={driveForm.missedRecovery} onChange={(event) => setDriveForm({ ...driveForm, missedRecovery: event.target.checked })} />
                <span>Run one backup for missed times when I next open the app</span>
              </label>
              <Field label="Keep successful scheduled backups">
                <select value={driveForm.retention} onChange={(event) => setDriveForm({ ...driveForm, retention: event.target.value })}>
                  <option value="7">Last 7 backups</option>
                  <option value="30">Last 30 backups</option>
                  <option value="all">Keep all backups</option>
                </select>
              </Field>
            </div>
            <div className="weekly-schedule">
              <div className="weekly-schedule-heading">
                <div><b>Weekly schedule</b><span>Times use this computer’s local time. If several times were missed while the computer was off, only one catch-up backup runs.</span></div>
                <Button kind="secondary" type="button" onClick={applyMondayScheduleToAllDays} disabled={!driveForm.weeklySchedule["1"]?.length}>
                  Use Monday’s times every day
                </Button>
              </div>
              {BACKUP_WEEKDAYS.map(({ key, label }) => {
                const times = driveForm.weeklySchedule[key] || [];
                const draft = backupTimeDrafts[key] || "";
                return (
                  <div className="weekly-schedule-day" key={key}>
                    <b>{label}</b>
                    <div className="weekly-schedule-times">
                      {times.length ? times.map((time) => (
                        <span className="weekly-schedule-time" key={time}>
                          {time}
                          <button type="button" aria-label={`Remove ${time} on ${label}`} onClick={() => removeBackupTime(key, time)}><X size={13} /></button>
                        </span>
                      )) : <small>No backups scheduled</small>}
                    </div>
                    <div className="weekly-schedule-add">
                      <input type="time" aria-label={`New backup time for ${label}`} value={draft} onChange={(event) => setBackupTimeDrafts((current) => ({ ...current, [key]: event.target.value }))} />
                      <Button kind="secondary" type="button" icon={Plus} onClick={() => addBackupTime(key)} disabled={!draft || times.includes(draft)}>
                        Add time
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="backup-recovery-key">
              <b>{driveData?.passphraseConfigured ? "Recovery passphrase is set on this computer" : "Set a recovery passphrase"}</b>
              <span>Choose at least 12 characters. It encrypts every Drive backup and is protected locally by the operating system. Keep it somewhere safe: you will need the same passphrase to restore on another computer. Changing it does not re-encrypt older backups.</span>
              <div className="form-two">
                <Field label={driveData?.passphraseConfigured ? "New recovery passphrase (optional)" : "Recovery passphrase"} required={!driveData?.passphraseConfigured}>
                  <input type="password" autoComplete="new-password" value={driveForm.recoveryPassphrase} onChange={(event) => setDriveForm({ ...driveForm, recoveryPassphrase: event.target.value })} />
                </Field>
                <Field label="Confirm recovery passphrase" required={Boolean(driveForm.recoveryPassphrase)}>
                  <input type="password" autoComplete="new-password" value={driveForm.recoveryPassphraseConfirm} onChange={(event) => setDriveForm({ ...driveForm, recoveryPassphraseConfirm: event.target.value })} />
                </Field>
              </div>
            </div>
            <div className="backup-status-grid">
              <div><span>Last successful local backup</span><b>{driveData?.lastSuccessfulLocal ? new Date(`${driveData.lastSuccessfulLocal.created_at.replace(" ", "T")}Z`).toLocaleString() : "Not yet backed up"}</b></div>
              <div><span>Last successful Drive backup</span><b>{driveData?.lastSuccessful ? new Date(`${driveData.lastSuccessful.created_at.replace(" ", "T")}Z`).toLocaleString() : "Not yet backed up"}</b></div>
              <div><span>Next scheduled backup</span><b>{driveData?.settings.nextScheduled ? new Date(driveData.settings.nextScheduled).toLocaleString() : "Automatic backup is off"}</b></div>
              <div><span>Latest backup status</span><b>{driveData?.settings.lastStatus || "No scheduled result yet"}{driveData?.settings.lastError ? ` — ${driveData.settings.lastError}` : ""}</b></div>
            </div>
            <div className="settings-actions">
              <Button type="submit" disabled={Boolean(driveBusy)}>{driveBusy === "save" ? "Saving…" : "Save schedule and Drive settings"}</Button>
            </div>
          </form>
          <div className="backup-info drive-actions">
            <div>
              <Download size={17} />
              <div><b>Manual encrypted backup</b><span>Uploads a new backup immediately; it does not count as today’s scheduled backup.</span></div>
            </div>
            <Button kind="secondary" type="button" onClick={cloudBackupNow} disabled={!driveData?.connected?.connected || !driveData?.passphraseConfigured || Boolean(driveBusy)}>
              {driveBusy === "upload" ? "Encrypting and uploading…" : "Backup Now"}
            </Button>
          </div>
          <div className="backup-info drive-actions">
            <div>
              <ArrowDownToLine size={17} />
              <div><b>Restore from Google Drive</b><span>Choose an encrypted backup. A local safety copy is retained before replacing the database.</span></div>
            </div>
            <Button kind="secondary" type="button" onClick={loadDriveBackups} disabled={!driveData?.connected?.connected || Boolean(driveBusy)}>
              {driveBusy === "list" ? "Loading…" : "List backups"}
            </Button>
          </div>
          {driveBackups && (
            <div className="drive-backup-list">
              {driveBackups.length === 0 ? <p>No Tuition Manager backups were found for this centre.</p> : driveBackups.map((backupItem) => (
                <div className="drive-backup-row" key={backupItem.id}>
                  <div><b>{backupItem.name}</b><span>{new Date(backupItem.createdTime).toLocaleString()} · {(backupItem.size / (1024 * 1024)).toFixed(2)} MB · Uploaded</span></div>
                  <Button kind="secondary" type="button" onClick={() => restoreDriveBackup(backupItem.id)} disabled={Boolean(driveBusy)}>
                    {driveBusy === "restore" ? "Restoring…" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {driveData?.history?.length > 0 && (
            <div className="backup-history">
              <b>Recent backup history</b>
              <div className="backup-history-scroll">
                {driveData.history.map((item) => (
                  <div key={item.backup_id}>
                    <span>{item.backup_type.replace("google-", "Google ").replace("local-scheduled", "Local scheduled").replace("local", "Local")} · {new Date(`${item.created_at.replace(" ", "T")}Z`).toLocaleString()}</span>
                    <strong className={item.status === "success" ? "backup-history-success" : "backup-history-failed"}>{item.status}</strong>
                    {item.error_message && <small>{item.error_message}</small>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="panel settings-card account-settings">
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-purple">
              <Users size={19} />
            </div>
            <div>
              <h2>Your account</h2>
              <p>The signed-in account for this workspace</p>
            </div>
          </div>
          <div className="account-details">
            <div className="account-detail">
              <span>Username</span>
              <b>{user.username}</b>
            </div>
            <div className="account-detail">
              <span>Access level</span>
              <b>{user.role === "admin" ? "Administrator" : "Staff"}</b>
            </div>
            <div className="account-detail">
              <span>Workspace</span>
              <b>{user.organization}</b>
            </div>
          </div>
        </section>
        <div className="local-note">
          <ShieldCheck size={16} />
          <span>
            Workspace data is stored locally on this computer. Sign in
            credentials never leave this device.
          </span>
        </div>
      </div>
    </div>
  );
}

function ModalHost({
  modal,
  close,
  refresh,
  version,
  notify,
  setModal,
  navigate,
}) {
  const finish = () => {
    close();
    refresh();
  };
  const body =
    modal.type === "student-form" ? (
      <StudentForm
        student={modal.student}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "teacher-form" ? (
      <TeacherForm
        teacher={modal.teacher}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "class-form" ? (
      <ClassForm
        classItem={modal.classItem}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "enrollment-form" ? (
      <EnrollmentForm
        version={version}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "class-detail" ? (
      <ClassDetail
        classItem={modal.classItem}
        version={version}
        close={close}
        setModal={setModal}
        refresh={refresh}
        notify={notify}
      />
    ) : modal.type === "student-detail" ? (
      <StudentDetail
        student={modal.student}
        initialSelectedFees={modal.selectedFees}
        version={version}
        close={close}
        setModal={setModal}
        refresh={refresh}
      />
    ) : modal.type === "session" ? (
      <SessionModal
        session={modal.session}
        version={version}
        close={close}
        refresh={refresh}
        notify={notify}
        setModal={setModal}
      />
    ) : modal.type === "special-session-form" ? (
      <SpecialSessionForm
        date={modal.date}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "payment-review" ? (
      <PaymentReview
        rows={modal.rows}
        month={modal.month}
        sessionId={modal.session_id}
        onComplete={modal.session ? () => {
          refresh();
          setModal({ type: "session", session: modal.session });
        } : null}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "payment-batch-review" ? (
      <BatchPaymentReview
        items={modal.items}
        close={close}
        refresh={refresh}
        notify={notify}
      />
    ) : modal.type === "payment-receipt-detail" ? (
      <PaymentReceiptDetail
        receipt={modal.receipt}
        close={close}
        notify={notify}
      />
    ) : modal.type === "student-fee-review" ? (
      <StudentFeeReview
        fees={modal.fees}
        studentName={modal.studentName}
        revise={() => setModal({
          type: "student-detail",
          student: modal.student,
          selectedFees: modal.fees.map((fee) => `${fee.enrollment_id}:${fee.month}`),
        })}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "payout-form" ? (
      <PayoutForm close={close} finish={finish} notify={notify} />
    ) : modal.type === "teacher-opening-balance-form" ? (
      <TeacherOpeningBalanceForm close={close} finish={finish} notify={notify} />
    ) : modal.type === "hall-form" ? (
      <HallForm
        hall={modal.hall}
        close={close}
        finish={finish}
        notify={notify}
      />
    ) : modal.type === "go-page" ? (
      <PageJump page={modal.page} close={close} navigate={navigate} />
    ) : null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`modal-window ${modal.type === "session" ? "session-modal-window" : ""} ${modal.type === "class-detail" ? "class-detail-window" : ""} ${modal.type === "class-form" ? "class-form-window" : ""} ${modal.type === "payment-receipt-detail" ? "payment-window" : ""} ${["session", "class-detail", "class-form", "enrollment-form"].includes(modal.type) ? "modal-window-wide" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        {body}
      </div>
    </div>
  );
}
function ModalTitle({ eyebrow, title, description, close, back, action, className = "" }) {
  return (
    <div className={`modal-title ${className}`}>
      {back && (
        <button
          className="icon-button modal-back"
          onClick={back}
          aria-label="Go back"
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
      <button
        className="icon-button modal-close"
        onClick={close}
        aria-label="Close dialog"
      >
        <X size={18} />
      </button>
    </div>
  );
}
function ModalActions({ close, saving, label = "Save changes" }) {
  return (
    <div className="modal-actions">
      <Button kind="secondary" onClick={close}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : label}
        <ArrowRight size={15} />
      </Button>
    </div>
  );
}

function PaymentReview({ rows, month, sessionId, onComplete, close, finish, notify }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const total = rows.reduce((sum, row) => sum + Number(row.due_amount || 0), 0);
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const receipt = await api.payments.pay({
        enrollment_ids: rows.map((row) => row.enrollment_id),
        month,
        session_id: sessionId,
      });
      notify(`${rows.length} payment${rows.length === 1 ? "" : "s"} recorded. Receipt number: ${receipt.receipt_code}`);
      if (onComplete) onComplete();
      else finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="REVIEW BEFORE RECORDING"
        title="Confirm tuition payments"
        description={`Review the ${month} payment details. Choose Revise to return to the list without recording anything.`}
        close={close}
      />
      <div className="payment-review-content">
        <div className="payment-review-list">
          {rows.map((row) => (
            <div className="payment-review-row" key={row.enrollment_id}>
              <div>
                <b>{row.name}</b>
                <span>{row.class_name}</span>
              </div>
              <b>{money(row.due_amount)}</b>
            </div>
          ))}
        </div>
        <div className="payment-review-total">
          <span>{rows.length} fee{rows.length === 1 ? "" : "s"} · {month}</span>
          <b>{money(total)}</b>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <Button kind="secondary" onClick={close} disabled={saving}>
            Revise selection
          </Button>
          <Button onClick={confirm} disabled={saving}>
            {saving ? "Recording…" : "Confirm and record"}
            <Check size={15} />
          </Button>
        </div>
      </div>
    </>
  );
}

function BatchPaymentReview({ items, close, refresh, notify }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const total = items.reduce((sum, item) => sum + Number(item.due_amount || 0), 0);
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const savedReceipt = await api.payments.make(items.map((item) => ({
        enrollment_id: item.enrollment_id,
        for_month: item.for_month,
      })));
      setReceipt(savedReceipt);
      refresh();
      notify(`Payment recorded. Receipt number: ${savedReceipt.receipt_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow={receipt ? "PAYMENT RECORDED" : "PAYMENT CONFIRMATION"}
        title={receipt ? "Payment receipt" : "Make payment"}
        description={receipt
          ? `Payment recorded on ${receipt.payment_date} at ${receipt.payment_time}.`
          : `Confirm ${items.length} selected pending payment${items.length === 1 ? "" : "s"}. A unique receipt number will be created.`}
        close={close}
      />
      <div className="payment-review-content">
        {receipt ? (
          <div className="payment-receipt-success">
            <div className="payment-receipt-code-block">
              <div className="payment-receipt-code-copy">
                <b>{receipt.receipt_code}</b>
                <Code39Barcode value={receipt.receipt_code} />
              </div>
            </div>
            <div className="payment-review-list">
              {receipt.rows.map((row) => (
                <div className="payment-review-row" key={row.payment_id}>
                  <div><b>{row.student_name} · {row.class_name}</b><span>{row.for_month}</span></div>
                  <b>{money(row.amount_paid)}</b>
                </div>
              ))}
            </div>
            <div className="payment-review-total"><span>Total paid</span><b>{money(receipt.total)}</b></div>
            <PaymentReceiptActions receiptCode={receipt.receipt_code} notify={notify} />
          </div>
        ) : (
          <>
            <div className="payment-review-list">
              {items.map((item) => (
                <div className="payment-review-row" key={`${item.enrollment_id}-${item.for_month}`}>
                  <div><b>{item.name} · {item.class_name}</b><span>{item.for_month}</span></div>
                  <b>{money(item.due_amount)}</b>
                </div>
              ))}
            </div>
            <div className="payment-review-total"><span>Total amount to pay</span><b>{money(total)}</b></div>
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {receipt ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button kind="secondary" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={confirm} disabled={saving}>
                {saving ? "Recording…" : "Confirm payment"}
                <Check size={15} />
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PaymentReceiptActions({ receiptCode, notify }) {
  const [busy, setBusy] = useState("");
  const download = async () => {
    setBusy("download");
    try {
      const result = await api.payments.exportReceipt(receiptCode);
      if (!result.canceled) notify("Payment receipt downloaded as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy("");
    }
  };
  const print = async () => {
    setBusy("print");
    try {
      await api.payments.printReceipt(receiptCode);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="payment-receipt-actions">
      <Button className="payment-receipt-print-button" icon={Printer} onClick={print} disabled={Boolean(busy)}>
        {busy === "print" ? "Opening print dialog…" : "Print receipt"}
      </Button>
      <Button className="payment-receipt-download-button" icon={Download} onClick={download} disabled={Boolean(busy)}>
        {busy === "download" ? "Preparing PDF…" : "Download receipt"}
      </Button>
    </div>
  );
}

function PaymentReceiptDetail({ receipt, close, notify }) {
  return (
    <>
      <ModalTitle
        eyebrow="PAYMENT RECEIPT"
        title="Receipt details"
        description={`Paid on ${prettyDate(receipt.payment_date)} at ${receipt.payment_time}`}
        close={close}
        className="payment-receipt-modal-title"
      />
      <div className="payment-receipt-modal-content">
        <div className="payment-receipt-modal-banner">
          <div className="payment-receipt-modal-copy">
            <span>Payment details</span>
            <small>Paid {prettyDate(receipt.payment_date)} · {receipt.payment_time}</small>
          </div>
          <div className="payment-receipt-modal-barcode">
            <b>{receipt.receipt_code}</b>
            <Code39Barcode value={receipt.receipt_code} />
          </div>
        </div>
        <div className="payment-receipt-modal-stats">
          <div><span>Total paid</span><b>{money(receipt.total)}</b></div>
          <div><span>Class fees</span><b>{receipt.rows.length}</b></div>
          <div><span>Students</span><b>{new Set(receipt.rows.map((row) => row.stid)).size}</b></div>
        </div>
        <div className="payment-receipt-modal-list">
          <div className="payment-receipt-modal-list-heading">
            <h3>Payment details</h3><span>{receipt.rows.length} item{receipt.rows.length === 1 ? "" : "s"}</span>
          </div>
          {receipt.rows.map((row, index) => (
            <div className="payment-receipt-modal-row" key={row.payment_id}>
              <span className="payment-receipt-row-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="payment-receipt-row-copy">
                <b>{row.student_name}</b>
                <span>{row.class_name} · {row.for_month}{row.rfid ? ` · RFID ${row.rfid}` : ""}</span>
              </div>
              <b className="payment-receipt-row-amount">{money(row.amount_paid)}</b>
            </div>
          ))}
          <div className="payment-receipt-modal-total"><span>Total paid</span><b>{money(receipt.total)}</b></div>
        </div>
        <PaymentReceiptActions receiptCode={receipt.receipt_code} notify={notify} />
        <div className="payment-receipt-modal-done">
          <Button kind="secondary" onClick={close}>Close</Button>
        </div>
      </div>
    </>
  );
}

function StudentFeeReview({ fees, studentName, revise, close, finish, notify }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const total = fees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const receipt = await api.students.payFees(fees.map((fee) => ({
        enrollment_id: fee.enrollment_id,
        month: fee.month,
      })));
      notify(`Selected tuition payments recorded. Receipt number: ${receipt.receipt_code}`);
      finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="REVIEW BEFORE RECORDING"
        title="Review student payments"
        description={`Check the selected class fees for ${studentName}. Revise returns to the profile without saving.`}
        close={close}
      />
      <div className="payment-review-content">
        <div className="payment-review-list">
          {fees.map((fee) => (
            <div className="payment-review-row" key={`${fee.enrollment_id}-${fee.month}`}>
              <div><b>{fee.class_name}</b><span>{fee.month}</span></div>
              <b>{money(fee.amount)}</b>
            </div>
          ))}
        </div>
        <div className="payment-review-total"><span>{studentName} · {fees.length} fee{fees.length === 1 ? "" : "s"}</span><b>{money(total)}</b></div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <Button kind="secondary" onClick={revise} disabled={saving}>Revise selection</Button>
          <Button onClick={confirm} disabled={saving}>{saving ? "Recording…" : "Confirm and record"}<Check size={15} /></Button>
        </div>
      </div>
    </>
  );
}

function StudentForm({ student, close, finish, notify }) {
  const [form, setForm] = useState({
    name: student?.name || "",
    school: student?.school || "",
    contact1: student?.contact1 || "",
    contact2: student?.contact2 || "",
    birthday: student?.birthday || "",
    address: student?.address || "",
    status: student?.status || "active",
  });
  const [photoData, setPhotoData] = useState(undefined);
  const [photoError, setPhotoError] = useState("");
  const { data: savedPhoto } = useLoad(
    () => student ? api.students.photo(student.stid) : Promise.resolve(null),
    [student?.stid],
  );
  const displayedPhoto = photoData === undefined ? savedPhoto : photoData;
  const [saving, setSaving] = useState(false);
  const change = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  const choosePhoto = async () => {
    setPhotoError("");
    try {
      const result = await api.students.choosePhoto();
      if (!result.canceled) setPhotoData(result.data);
    } catch (err) {
      setPhotoError(err.message);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.students.save({
        ...form,
        stid: student?.stid,
        ...(photoData !== undefined ? { photo_data: photoData } : {}),
      });
      notify(
        student ? "Student details updated." : "Student added successfully.",
      );
      finish();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="STUDENT PROFILE"
        title={student ? "Edit student" : "Add a student"}
        description="Keep the details that help your centre stay connected."
        close={close}
      />
      <form className="modal-form" onSubmit={submit}>
        <div className="student-photo-picker">
          <Avatar
            name={form.name || "Student"}
            photo={displayedPhoto || defaultProfilePhoto}
            className="student-photo-preview"
          />
          <div className="student-photo-controls">
            <b>Student photo <span>Optional</span></b>
            <small>JPEG, PNG or WebP, up to 2 MB.</small>
            <div>
              <Button kind="secondary" type="button" onClick={choosePhoto}>
                {displayedPhoto ? "Change photo" : "Choose photo"}
              </Button>
              {displayedPhoto && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setPhotoData(null)}
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
        </div>
        {photoError && <div className="form-error">{photoError}</div>}
        <Field
          label="Student’s full name"
          required
          value={form.name}
          onChange={change("name")}
          placeholder="e.g. Aisha Perera"
        />
        <div className="form-two">
          <Field
            label="School"
            value={form.school}
            onChange={change("school")}
            placeholder="School name"
          />
          <Field
            label="Date of birth"
            type="date"
            value={form.birthday}
            onChange={change("birthday")}
          />
        </div>
        <div className="form-two">
          <Field
            label="Primary contact"
            required
            type="tel"
            value={form.contact1}
            onChange={change("contact1")}
            placeholder="Parent or guardian"
          />
          <Field
            label="Other contact"
            type="tel"
            value={form.contact2}
            onChange={change("contact2")}
            placeholder="Optional"
          />
        </div>
        <Field
          label="Home address"
          value={form.address}
          onChange={change("address")}
          placeholder="Optional"
        />
        {student && (
          <SelectField
            label="Student status"
            value={form.status}
            onChange={change("status")}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        )}
        <ModalActions
          close={close}
          saving={saving}
          label={student ? "Save student" : "Add student"}
        />
      </form>
    </>
  );
}

function TeacherForm({ teacher, close, finish, notify }) {
  const [form, setForm] = useState({
    name: teacher?.name || "",
    contact: teacher?.contact || "",
    address: teacher?.address || "",
    description: teacher?.description || "",
  });
  const [saving, setSaving] = useState(false);
  const change = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.teachers.save({ ...form, tid: teacher?.tid });
      notify(
        teacher ? "Teacher details updated." : "Teacher added successfully.",
      );
      finish();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${teacher.name}?`)) return;
    try {
      await api.teachers.delete(teacher.tid);
      notify("Teacher removed.");
      finish();
    } catch (err) {
      notify(err.message, "error");
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="TEACHING TEAM"
        title={teacher ? "Edit teacher" : "Add a teacher"}
        description="Add someone new to your tuition centre."
        close={close}
      />
      <form className="modal-form" onSubmit={submit}>
        <Field
          label="Teacher’s name"
          required
          value={form.name}
          onChange={change("name")}
          placeholder="Full name"
        />
        <Field
          label="Contact number"
          type="tel"
          value={form.contact}
          onChange={change("contact")}
          placeholder="Phone or WhatsApp"
        />
        <Field
          label="Address"
          value={form.address}
          onChange={change("address")}
          placeholder="Optional"
        />
        <Field
          label="About the teacher"
          value={form.description}
          onChange={change("description")}
          placeholder="Subjects, experience or a short note"
        />
        <div className="modal-actions">
          {teacher && (
            <button
              type="button"
              className="button button-danger-text"
              onClick={remove}
            >
              Remove
            </button>
          )}
          <span className="action-spacer" />
          <Button kind="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : teacher ? "Save teacher" : "Add teacher"}
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}

const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
function ClassForm({ classItem, close, finish, notify }) {
  const { data: teachers } = useLoad(() => api.teachers.list(), []);
  const { data: halls } = useLoad(() => api.halls.list(), []);
  const { data: detail } = useLoad(
    () =>
      classItem
        ? api.classes.detail(classItem.class_id)
        : Promise.resolve(null),
    [],
  );
  const [form, setForm] = useState({
    class_name: classItem?.class_name || "",
    tid: classItem?.tid ? String(classItem.tid) : "",
    subject: classItem?.subject || "",
    fee: classItem?.fee ?? "",
    teacher_commission_percentage:
      classItem?.teacher_commission_percentage ?? 0,
    hall_id: classItem?.hall_id ? String(classItem.hall_id) : "",
    status: classItem?.status || "active",
    schedules: [],
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (detail)
      setForm((current) => ({ ...current, schedules: detail.schedules }));
  }, [detail]);
  const change = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  const setSchedule = (index, key, value) =>
    setForm({
      ...form,
      schedules: form.schedules.map((row, i) =>
        i === index ? { ...row, [key]: value } : row,
      ),
    });
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.classes.save({
        ...form,
        class_id: classItem?.class_id,
        tid: Number(form.tid),
        fee: Number(form.fee),
        teacher_commission_percentage: Number(
          form.teacher_commission_percentage,
        ),
        hall_id: form.hall_id ? Number(form.hall_id) : null,
      });
      notify(classItem ? "Class updated." : "Class created.");
      finish();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="CLASS DETAILS"
        title={classItem ? "Edit class" : "Create a class"}
        description="Set up a class, its fee and weekly timetable."
        close={close}
      />
      <form className="modal-form class-form-modal-form" onSubmit={submit}>
        <div className="class-form-fields">
          <Field
            label="Class name"
            required
            value={form.class_name}
            onChange={change("class_name")}
            placeholder="e.g. Grade 10 Mathematics"
          />
          <Field
            label="Subject"
            value={form.subject}
            onChange={change("subject")}
            placeholder="e.g. Mathematics"
          />
          <SelectField
            label="Teacher"
            required
            value={form.tid}
            onChange={change("tid")}
            options={[
              {
                value: "",
                label: teachers?.length
                  ? "Choose a teacher"
                  : "Add a teacher first",
              },
              ...(teachers || []).map((t) => ({
                value: String(t.tid),
                label: t.name,
              })),
            ]}
          />
          <Field
            label="Monthly fee"
            required
            type="number"
            min="0"
            step="0.01"
            value={form.fee}
            onChange={change("fee")}
            placeholder="0.00"
          />
          <Field
            label="Teacher commission"
            required
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={form.teacher_commission_percentage}
            onChange={change("teacher_commission_percentage")}
            placeholder="0"
          />
          <SelectField
            label="Hall (optional)"
            value={form.hall_id}
            onChange={change("hall_id")}
            options={[
              { value: "", label: "No hall selected" },
              ...(halls || []).map((h) => ({
                value: String(h.hall_id),
                label: `${h.name} · ${availabilityLabel(h.availability)}`,
              })),
            ]}
          />
        </div>
        <div className="schedule-editor">
          <div className="schedule-heading">
            <div>
              <b>Weekly schedule</b>
              <span>Add one or more class times</span>
            </div>
            <button
              type="button"
              className="text-link"
              onClick={() =>
                setForm({
                  ...form,
                  schedules: [
                    ...form.schedules,
                    {
                      day_of_week: "monday",
                      start_time: "09:00",
                      end_time: "10:00",
                    },
                  ],
                })
              }
            >
              <Plus size={14} /> Add time
            </button>
          </div>
          <div className="class-schedule-grid">
          {form.schedules.map((row, index) => (
            <div className="schedule-row" key={index}>
              <select
                aria-label="Day of week"
                value={row.day_of_week}
                onChange={(event) =>
                  setSchedule(index, "day_of_week", event.target.value)
                }
              >
                {weekdays.map((day) => (
                  <option value={day} key={day}>
                    {day[0].toUpperCase() + day.slice(1)}
                  </option>
                ))}
              </select>
              <input
                aria-label="Start time"
                type="time"
                value={row.start_time}
                onChange={(event) =>
                  setSchedule(index, "start_time", event.target.value)
                }
              />
              <span>to</span>
              <input
                aria-label="End time"
                type="time"
                value={row.end_time}
                onChange={(event) =>
                  setSchedule(index, "end_time", event.target.value)
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove schedule"
                onClick={() =>
                  setForm({
                    ...form,
                    schedules: form.schedules.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          </div>
        </div>
        {classItem && (
          <SelectField
            label="Class status"
            value={form.status}
            onChange={change("status")}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        )}
        <ModalActions
          close={close}
          saving={saving}
          label={classItem ? "Save class" : "Create class"}
        />
      </form>
    </>
  );
}

function EnrollmentForm({ version, close, finish, notify }) {
  const { data: classes, error: classesError } = useLoad(
    () => api.classes.list(),
    [version],
  );
  const { data: students, error: studentsError } = useLoad(
    () => api.students.list(),
    [version],
  );
  const [classId, setClassId] = useState("");
  const { data: detail, error: detailError } = useLoad(
    () =>
      classId ? api.classes.detail(Number(classId)) : Promise.resolve(null),
    [classId, version],
  );
  const [selected, setSelected] = useState([]);
  const [discounts, setDiscounts] = useState({});
  const [studentQuery, setStudentQuery] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const classItem = (classes || []).find(
    (item) => String(item.class_id) === classId,
  );
  const available = (students || []).filter(
    (student) =>
      student.status === "active" &&
      !detail?.enrollments.some(
        (enrollment) =>
          enrollment.stid === student.stid && enrollment.status === "active",
      ),
  );
  const matchingStudents = available.filter((student) =>
    `${student.name} ${student.rfid || ""}`
      .toLowerCase()
      .includes(studentQuery.trim().toLowerCase()),
  );
  const visibleStudents = pageSlice(matchingStudents, studentPage);
  const fee = (discount) =>
    roundMoney(Number(classItem?.fee || 0) * (1 - Number(discount || 0) / 100));
  const teacherShare = (discount) =>
    roundMoney(
      (fee(discount) * Number(classItem?.teacher_commission_percentage || 0)) /
        100,
    );
  const submit = async (event) => {
    event.preventDefault();
    if (!selected.length) {
      setError("Select one or more students to enrol.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.classes.enroll({
        class_id: Number(classId),
        students: selected.map((stid) => ({
          stid,
          discount_percentage: Number(discounts[stid] || 0),
        })),
      });
      notify(
        `${selected.length} student${selected.length === 1 ? "" : "s"} enrolled in ${classItem.class_name}.`,
      );
      finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="CLASS ENROLMENT"
        title="Enroll students"
        description="Choose a class and students, then set an optional discount for each student."
        close={close}
      />
      <form className="modal-form modal-form-scroll" onSubmit={submit}>
        <SelectField
          label="Class"
          required
          value={classId}
          onChange={(event) => {
            setClassId(event.target.value);
            setSelected([]);
            setDiscounts({});
            setStudentQuery("");
            setStudentPage(1);
            setError("");
          }}
          options={[
            {
              value: "",
              label: classes?.length
                ? "Choose a class"
                : "Create a class first",
            },
            ...(classes || [])
              .filter((item) => item.status === "active")
              .map((item) => ({
                value: String(item.class_id),
                label: `${item.class_name} · ${item.teacher_name} · ${money(item.fee)} monthly`,
              })),
          ]}
        />
        {(classesError || studentsError || detailError) && (
          <div className="form-error">
            {classesError || studentsError || detailError}
          </div>
        )}
        {classItem && (
          <>
            <div className="enrollment-fee-note">
              <b>{classItem.class_name}</b>
              <span>Teacher: {classItem.teacher_name}</span>
              <span>
                Full fee {money(classItem.fee)} · Teacher share{" "}
                {classItem.teacher_commission_percentage}%
              </span>
              <small>
                Discounts reduce the tuition first; commission is calculated on
                the amount the student pays.
              </small>
            </div>
            <div className="table-search enrollment-search">
              <Search size={16} />
              <input
                aria-label="Search students by name or RFID"
                placeholder="Search students by name or RFID…"
                value={studentQuery}
                onChange={(event) => {
                  setStudentQuery(event.target.value);
                  setStudentPage(1);
                }}
              />
            </div>
            <div className="enroll-options enrollment-form-options">
              {matchingStudents.length ? (
                visibleStudents.map((student) => {
                  const discount = Number(discounts[student.stid] || 0);
                  const payable = fee(discount);
                  const teacher = teacherShare(discount);
                  return (
                    <div
                      className={`enroll-option ${selected.includes(student.stid) ? "enroll-option-selected" : ""}`}
                      key={student.stid}
                    >
                      <label className="enroll-choice">
                        <input
                          type="checkbox"
                          checked={selected.includes(student.stid)}
                          onChange={(event) =>
                            setSelected((ids) =>
                              event.target.checked
                                ? [...ids, student.stid]
                                : ids.filter((id) => id !== student.stid),
                            )
                          }
                        />
                        <span>{student.name}</span>
                      </label>
                      <div className="enroll-fee-editor">
                        <label>
                          <input
                            type="number"
                            aria-label={`Discount percentage for ${student.name}`}
                            min="0"
                            max="100"
                            step="0.1"
                            placeholder="0"
                            value={discounts[student.stid] ?? ""}
                            onChange={(event) =>
                              setDiscounts({
                                ...discounts,
                                [student.stid]: event.target.value,
                              })
                            }
                          />
                          <span>% off</span>
                        </label>
                        <b className="enroll-fee-amount">{money(payable)}</b>
                      </div>
                      {selected.includes(student.stid) && (
                        <div className="enroll-split">
                          <span>
                            Student pays <b>{money(payable)}</b>
                          </span>
                          <span>
                            Teacher <b>{money(teacher)}</b>
                          </span>
                          <span>
                            Organization <b>{money(payable - teacher)}</b>
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="roster-empty">
                  {studentQuery
                    ? "No active student matches that name or RFID."
                    : students?.length
                      ? "Every active student is already enrolled in this class."
                      : "Add students before enrolling them in a class."}
                </p>
              )}
            </div>
            {matchingStudents.length > 0 && (
              <Pagination
                count={matchingStudents.length}
                page={studentPage}
                setPage={setStudentPage}
              />
            )}
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <ModalActions
          close={close}
          saving={saving}
          label={
            selected.length
              ? `Enroll ${selected.length} student${selected.length === 1 ? "" : "s"}`
              : "Enroll students"
          }
        />
      </form>
    </>
  );
}

function ClassDetail({ classItem, version, close, setModal, refresh, notify }) {
  const [paymentReportBusy, setPaymentReportBusy] = useState(false);
  const { data: detail, error } = useLoad(
    () => api.classes.detail(classItem.class_id),
    [version],
  );
  const { data: students } = useLoad(() => api.students.list(), [version]);
  const [discounts, setDiscounts] = useState({});
  const [rosterQuery, setRosterQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [editValue, setEditValue] = useState("");
  const available = (students || []).filter(
    (student) =>
      student.status === "active" &&
      !detail?.enrollments.some(
        (e) => e.stid === student.stid && e.status === "active",
      ),
  );
  const activeEnrollments = (detail?.enrollments || []).filter((e) => e.status === "active");
  const filteredEnrollments = activeEnrollments.filter((enrollment) =>
    `${enrollment.name} ${enrollment.rfid || ""}`.toLowerCase().includes(rosterQuery.toLowerCase()),
  );
  const filteredCandidates = available.filter((student) =>
    `${student.name} ${student.rfid || ""}`.toLowerCase().includes(candidateQuery.toLowerCase()),
  );
  const [selected, setSelected] = useState([]);
  const feeFor = (discount) =>
    roundMoney(Number(classItem.fee) * (1 - Number(discount || 0) / 100));
  const shareFor = (discount, commission) =>
    roundMoney((feeFor(discount) * Number(commission || 0)) / 100);
  const exportPaymentRegister = async () => {
    if (paymentReportBusy) return;
    setPaymentReportBusy(true);
    try {
      const result = await api.reports.exportClassPaymentPDF({
        year: thisMonth().slice(0, 4),
        class_id: classItem.class_id,
      });
      if (!result.canceled) notify("Class payment register exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setPaymentReportBusy(false);
    }
  };
  const saveEnrollments = async () => {
    setSaving(true);
    try {
      await api.classes.enroll({
        class_id: classItem.class_id,
        students: selected.map((stid) => ({
          stid,
          discount_percentage: Number(discounts[stid] || 0),
        })),
      });
      notify("Students enrolled in this class.");
      setSelected([]);
      refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  const drop = async (enrollment) => {
    if (!window.confirm(`Remove ${enrollment.name} from this class?`)) return;
    try {
      await api.classes.dropEnrollment(enrollment.enrollment_id);
      notify("Student removed from class.");
      refresh();
    } catch (err) {
      notify(err.message, "error");
    }
  };
  const saveDiscount = async (enrollment) => {
    setSaving(true);
    try {
      await api.classes.updateDiscount({
        enrollment_id: enrollment.enrollment_id,
        discount_percentage: Number(editValue),
      });
      notify(`Discount updated for ${enrollment.name}.`);
      setEditingDiscount(null);
      refresh();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow={classItem.subject || "CLASS ROSTER"}
        title={classItem.class_name}
        description={`${classItem.teacher_name} · ${money(classItem.fee)} per month · ${classItem.teacher_commission_percentage}% teacher share`}
        className="class-detail-title"
        action={
          <Button kind="secondary" icon={Download} onClick={exportPaymentRegister} disabled={paymentReportBusy}>
            {paymentReportBusy ? "Preparing PDF…" : "Payment register PDF"}
          </Button>
        }
        close={close}
      />
      {error && <div className="error-inline">{error}</div>}
      <div className="class-detail-content">
        <div className="class-detail-columns">
        <section className="class-roster-column">
        <div className="roster-heading">
          <b>
            Enrolled students{" "}
            <span className="roster-count">
              {activeEnrollments.length}
            </span>
          </b>
          <button className="text-link" onClick={() => setModal({ type: "class-form", classItem })}>Edit class</button>
        </div>
        {activeEnrollments.length > 0 && (
          <div className="table-search roster-search">
            <Search size={15} />
            <input
              aria-label="Search enrolled students by name or RFID"
              placeholder="Search enrolled students by name or RFID…"
              value={rosterQuery}
              onChange={(event) => {
                setRosterQuery(event.target.value);
              }}
            />
          </div>
        )}
        <div className="roster-list">
          {filteredEnrollments.length ? filteredEnrollments.map((enrollment) => (
              <div
                className="roster-row roster-discount-row"
                key={enrollment.enrollment_id}
              >
                <StudentAvatar stid={enrollment.stid} name={enrollment.name} version={version} />
                <div className="roster-name">
                  <b>{enrollment.name}</b>
                  <span>
                    {enrollment.discount_percentage}% discount · pays{" "}
                    {money(feeFor(enrollment.discount_percentage))} · teacher{" "}
                    {money(
                      shareFor(
                        enrollment.discount_percentage,
                        classItem.teacher_commission_percentage,
                      ),
                    )}{" "}
                    · centre{" "}
                    {money(
                      feeFor(enrollment.discount_percentage) -
                        shareFor(
                          enrollment.discount_percentage,
                          classItem.teacher_commission_percentage,
                        ),
                    )}
                  </span>
                  {editingDiscount === enrollment.enrollment_id && (
                    <div className="edit-discount">
                      <label>
                        Discount{" "}
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                        />
                        %
                      </label>
                      <b>
                        Student pays {money(feeFor(editValue))} · teacher{" "}
                        {money(
                          shareFor(
                            editValue,
                            classItem.teacher_commission_percentage,
                          ),
                        )}{" "}
                        · organization{" "}
                        {money(
                          feeFor(editValue) -
                            shareFor(
                              editValue,
                              classItem.teacher_commission_percentage,
                            ),
                        )}
                      </b>
                      <Button
                        kind="secondary"
                        onClick={() => saveDiscount(enrollment)}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save discount"}
                      </Button>
                    </div>
                  )}
                </div>
                <button
                  className="small-action"
                  onClick={() => {
                    setEditingDiscount(
                      editingDiscount === enrollment.enrollment_id
                        ? null
                        : enrollment.enrollment_id,
                    );
                    setEditValue(String(enrollment.discount_percentage));
                  }}
                >
                  {editingDiscount === enrollment.enrollment_id
                    ? "Cancel"
                    : "Edit discount"}
                </button>
                <button
                  className="icon-button"
                  title="Remove from class"
                  onClick={() => drop(enrollment)}
                >
                  <X size={16} />
                </button>
              </div>
          )) : <p className="roster-empty">No enrolled student matches this search.</p>}
        </div>
        {activeEnrollments.length === 0 && (
          <p className="roster-empty">No students are enrolled yet.</p>
        )}
        </section>
        <section className="class-enrollment-column">
        <div className="enroll-box">
          <div className="enroll-box-heading">
            <div>
              <b>Enroll students</b>
              <span>
                Choose students below. No discount means they pay the full
                monthly fee.
              </span>
            </div>
            <span className="base-fee">Full fee {money(classItem.fee)}</span>
          </div>
          <div className="table-search enrollment-search">
            <Search size={15} />
            <input
              aria-label="Search available students by name or RFID"
              placeholder="Search students by name or RFID…"
              value={candidateQuery}
              onChange={(event) => {
                setCandidateQuery(event.target.value);
              }}
            />
          </div>
          {filteredCandidates.length ? (
            <div className="enroll-options">
              {filteredCandidates.map((student) => {
                const discount = Number(discounts[student.stid] || 0);
                const fee = feeFor(discount);
                const teacher = shareFor(
                  discount,
                  classItem.teacher_commission_percentage,
                );
                return (
                  <div
                    className={`enroll-option ${selected.includes(student.stid) ? "enroll-option-selected" : ""}`}
                    key={student.stid}
                  >
                    <label className="enroll-choice">
                      <input
                        type="checkbox"
                        checked={selected.includes(student.stid)}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, student.stid]
                              : ids.filter((id) => id !== student.stid),
                          )
                        }
                      />
                      <span>{student.name}</span>
                    </label>
                    <div className="enroll-fee-editor">
                      <label>
                        <input
                          type="number"
                          aria-label={`Discount percentage for ${student.name}`}
                          min="0"
                          max="100"
                          step="0.1"
                          placeholder="0"
                          value={discounts[student.stid] ?? ""}
                          onChange={(event) =>
                            setDiscounts({
                              ...discounts,
                              [student.stid]: event.target.value,
                            })
                          }
                        />
                        <span>% off</span>
                      </label>
                      <b className="enroll-fee-amount">{money(fee)}</b>
                    </div>
                    {selected.includes(student.stid) && (
                      <div className="enroll-split">
                        <span>
                          Teacher ({classItem.teacher_commission_percentage}%){" "}
                          <b>{money(teacher)}</b>
                        </span>
                        <span>
                          Organization <b>{money(fee - teacher)}</b>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="roster-empty">
              {candidateQuery
                ? "No available student matches that name or RFID."
                : "All active students are enrolled, or there are no students yet."}
            </p>
          )}
          <Button
            onClick={saveEnrollments}
            disabled={!selected.length || saving}
          >
            {saving ? "Enrolling…" : `Enroll ${selected.length || ""} selected`}
          </Button>
        </div>
        </section>
        </div>
      </div>
    </>
  );
}

function StudentDetail({
  student: initial,
  initialSelectedFees = [],
  version,
  close,
  setModal,
  refresh,
}) {
  const [student, setStudent] = useState(initial);
  const [photoPreview, setPhotoPreview] = useState(false);
  const [card, setCard] = useState("");
  const [error, setError] = useState("");
  const { data: studentPhoto } = useLoad(
    () => student.stid ? api.students.photo(student.stid) : Promise.resolve(null),
    [student.stid, version],
  );
  useEffect(() => {
    if (!photoPreview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPhotoPreview(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [photoPreview]);
  const { data: enrollments } = useLoad(
    () => api.students.fees(student.stid),
    [student.stid, version],
  );
  const [selectedFees, setSelectedFees] = useState(initialSelectedFees);
  const [feeQuery, setFeeQuery] = useState("");
  const [feePage, setFeePage] = useState(1);
  const feeRows = (enrollments || [])
    .flatMap((enrollment) =>
      monthRange(enrollment.enrolled_date.slice(0, 7), thisMonth()).map(
        (month) => ({
          enrollment_id: enrollment.enrollment_id,
          month,
          paid: enrollment.paid_months.includes(month),
          class_name: enrollment.class_name,
          amount:
            Number(enrollment.fee) *
            (1 - Number(enrollment.discount_percentage) / 100),
          freeAccess: Number(enrollment.discount_percentage) >= 100,
        }),
      ),
    )
    .sort(
      (a, b) =>
        b.month.localeCompare(a.month) ||
        a.class_name.localeCompare(b.class_name),
    );
  const unpaidFees = feeRows.filter((row) => !row.paid && !row.freeAccess && row.amount > 0);
  const filteredFeeRows = feeRows.filter((row) =>
    `${row.class_name} ${row.month}`.toLowerCase().includes(feeQuery.toLowerCase()),
  );
  const assign = async () => {
    setError("");
    try {
      const assignedCard = card.trim();
      if (!assignedCard) {
        setError("Scan or enter an RFID card number.");
        return;
      }
      let result = await api.students.assignRfid({
        stid: student.stid,
        rfid: assignedCard,
      });
      if (result.conflict) {
        if (
          !window.confirm(
            `${result.conflict} already has this card. Reassign it?`,
          )
        )
          return;
        result = await api.students.assignRfid({
          stid: student.stid,
          rfid: assignedCard,
          reassign: true,
        });
      }
      if (result.success) {
        setStudent({ ...student, rfid: assignedCard });
        setCard("");
        refresh();
      }
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    try {
      const removed = await api.students.removeRfid(student.stid);
      if (!removed) throw new Error("The RFID card could not be removed.");
      setStudent({ ...student, rfid: null });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const paySelected = () => {
    const selectedRows = feeRows.filter((row) =>
      selectedFees.includes(`${row.enrollment_id}:${row.month}`),
    ).filter((row) => !row.freeAccess && row.amount > 0);
    if (selectedRows.length) {
      setModal({
        type: "student-fee-review",
        fees: selectedRows,
        studentName: student.name,
        student,
      });
    }
  };
  const monthLabel = (month) =>
    new Date(`${month}-02`).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  return (
    <>
      <ModalTitle
        eyebrow="STUDENT PROFILE"
        title={student.name}
        description={student.school || "Student details and class fees"}
        close={close}
      />
      <div className="student-detail">
        <div className="student-detail-top">
          <button
            type="button"
            className={`student-profile-photo${studentPhoto ? " is-clickable" : ""}`}
            onClick={() => studentPhoto && setPhotoPreview(true)}
            disabled={!studentPhoto}
            aria-label={studentPhoto ? `View ${student.name}'s photo` : `${student.name} has no profile photo`}
          >
            <Avatar name={student.name} photo={studentPhoto || defaultProfilePhoto} />
            {studentPhoto && <span>View photo</span>}
          </button>
          <div>
            <b>{student.name}</b>
            <span>
              {student.contact1}
              {student.contact2 ? ` · ${student.contact2}` : ""}
            </span>
          </div>
          <button
            className="text-link"
            onClick={() => setModal({ type: "student-form", student })}
          >
            Edit details
          </button>
        </div>
        <div className="detail-summary">
          <div>
            <span>School</span>
            <b>{student.school || "Not added"}</b>
          </div>
          <div>
            <span>Date of birth</span>
            <b>{prettyDate(student.birthday)}</b>
          </div>
          <div>
            <span>Status</span>
            <Status value={student.status} />
          </div>
        </div>
        {student.address && (
          <div className="address-detail">
            <span>Home address</span>
            <p>{student.address}</p>
          </div>
        )}
        <div className="detail-section-title">
          <b>RFID attendance card</b>
          <span>Scan a card or type its number</span>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="rfid-assign">
          {student.rfid ? (
            <>
              <span className="rfid-chip">
                <Activity size={12} />
                {student.rfid}
              </span>
              <button className="text-link danger-link" onClick={remove}>
                Remove card
              </button>
            </>
          ) : (
            <>
              <input
                value={card}
                onChange={(event) => setCard(event.target.value)}
                placeholder="Scan or enter card number"
                onKeyDown={(event) => event.key === "Enter" && assign()}
              />
              <Button kind="secondary" onClick={assign}>
                Assign card
              </Button>
            </>
          )}
        </div>
        <div className="detail-section-title fee-heading">
          <div>
            <b>Tuition payment history</b>
            <span>Unpaid class months since enrolment</span>
          </div>
          {unpaidFees.length > 0 && (
            <button
              className="text-link"
              onClick={() =>
                setSelectedFees(
                  selectedFees.length === unpaidFees.length
                    ? []
                    : unpaidFees.map(
                        (row) => `${row.enrollment_id}:${row.month}`,
                      ),
                )
              }
            >
              {selectedFees.length === unpaidFees.length
                ? "Clear selection"
                : "Select all unpaid"}
            </button>
          )}
        </div>
        {feeRows.length > 0 && (
          <div className="table-search student-fee-search">
            <Search size={15} />
            <input
              aria-label="Search student payment history"
              placeholder="Search class or month…"
              value={feeQuery}
              onChange={(event) => {
                setFeeQuery(event.target.value);
                setFeePage(1);
              }}
            />
          </div>
        )}
        {feeRows.length ? (
          <div className="student-fee-list">
            {filteredFeeRows.length ? pageSlice(filteredFeeRows, feePage).map((row) => {
              const key = `${row.enrollment_id}:${row.month}`;
              return (
                <label
                  className={`student-fee-row ${row.paid ? "fee-paid" : ""}`}
                  key={key}
                >
                  {!row.paid && !row.freeAccess && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.class_name}, ${monthLabel(row.month)}`}
                      checked={selectedFees.includes(key)}
                      onChange={(event) =>
                        setSelectedFees((keys) =>
                          event.target.checked
                            ? [...keys, key]
                            : keys.filter((item) => item !== key),
                        )
                      }
                    />
                  )}
                  <span className="fee-description">
                    <b>{row.class_name}</b>
                    <small>{monthLabel(row.month)}</small>
                  </span>
                  <b>
                    {row.freeAccess ? (
                      <span className="free-access-label">Free Access</span>
                    ) : row.paid ? (
                      <Status value="paid" />
                    ) : (
                      <span>{money(row.amount)}</span>
                    )}
                  </b>
                </label>
              );
            }) : <p className="roster-empty">No payment records match this search.</p>}
          </div>
        ) : (
          <p className="roster-empty">
            {enrollments?.length
              ? "No monthly fees due yet."
              : "No active class enrolments yet."}
          </p>
        )}
        {filteredFeeRows.length > 0 && (
          <Pagination count={filteredFeeRows.length} page={feePage} setPage={setFeePage} />
        )}
        <div className="student-profile-pay">
          <span>
            {selectedFees.length
              ? `${selectedFees.length} month${selectedFees.length === 1 ? "" : "s"} selected`
              : unpaidFees.length
                ? `${unpaidFees.length} unpaid month${unpaidFees.length === 1 ? "" : "s"}`
                : "All payments are up to date"}
          </span>
          <Button onClick={paySelected} disabled={!selectedFees.length}>
            <CreditCard size={15} />
            Record selected
          </Button>
        </div>
      </div>
      {photoPreview && studentPhoto && (
        <div
          className="student-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${student.name}'s profile photo`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPhotoPreview(false);
          }}
        >
          <button
            type="button"
            className="icon-button student-photo-lightbox-close"
            onClick={() => setPhotoPreview(false)}
            aria-label="Close photo preview"
          >
            <X size={20} />
          </button>
          <img src={studentPhoto} alt={`${student.name} profile`} />
          <span>{student.name}</span>
        </div>
      )}
    </>
  );
}

function SpecialSessionForm({ date, close, finish, notify }) {
  const { data: classes, error: classesError } = useLoad(() => api.classes.list(), []);
  const { data: halls, error: hallsError } = useLoad(() => api.halls.list(), []);
  const [form, setForm] = useState({
    class_id: "",
    session_date: date || today(),
    start_time: "09:00",
    end_time: "10:00",
    hall_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setError("");
    if (typeof api.sessions.scheduleSpecial !== "function") {
      setError("This app build does not include special-session support. Close and restart the desktop app, or install the latest version.");
      return;
    }
    setBusy(true);
    try {
      await api.sessions.scheduleSpecial(form);
      notify("One-time special session scheduled.");
      finish();
    } catch (err) {
      const message = String(err?.message || "Could not schedule the special session.");
      setError(
        message.replace(
          /^(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)+/,
          "",
        ).trim(),
      );
    } finally {
      setBusy(false);
    }
  };
  const activeClasses = (classes || []).filter((item) => item.status === "active");
  return (
    <>
      <ModalTitle
        eyebrow="ONE-TIME CLASS"
        title="Schedule a special session"
        description="Add an extra session on a specific date without changing the weekly timetable."
        close={close}
      />
      <form className="modal-form" onSubmit={save}>
        {error && <div className="form-error special-session-error">{error}</div>}
        {classesError && <div className="form-error">{classesError}</div>}
        {hallsError && <div className="form-error">{hallsError}</div>}
        <SelectField
          label="Class"
          required
          value={form.class_id}
          onChange={(event) => setForm({ ...form, class_id: event.target.value })}
          options={[
            { value: "", label: "Choose a class" },
            ...activeClasses.map((item) => ({ value: String(item.class_id), label: item.class_name })),
          ]}
        />
        <Field
          label="Session date"
          required
          type="date"
          value={form.session_date}
          onChange={(event) => setForm({ ...form, session_date: event.target.value })}
        />
        <div className="form-two">
          <Field
            label="Start time"
            required
            type="time"
            value={form.start_time}
            onChange={(event) => setForm({ ...form, start_time: event.target.value })}
          />
          <Field
            label="End time"
            required
            type="time"
            value={form.end_time}
            onChange={(event) => setForm({ ...form, end_time: event.target.value })}
          />
        </div>
        <SelectField
          label="Hall (optional)"
          value={form.hall_id}
          onChange={(event) => setForm({ ...form, hall_id: event.target.value })}
          options={[
            { value: "", label: "No hall selected" },
            ...(halls || []).map((hall) => ({ value: String(hall.hall_id), label: hall.name })),
          ]}
        />
        {!activeClasses.length && !classesError && (
          <div className="form-error">Create an active class before scheduling a special session.</div>
        )}
        <div className="modal-actions">
          <Button kind="secondary" type="button" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={busy || !activeClasses.length || Boolean(classesError) || Boolean(hallsError)}>
            {busy ? "Scheduling…" : "Schedule session"}
          </Button>
        </div>
      </form>
    </>
  );
}

function SessionModal({ session, version, close, refresh, notify, setModal }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(session.status);
  const [registerOpenedAt, setRegisterOpenedAt] = useState(session.register_opened_at || null);
  const [classStartedAt, setClassStartedAt] = useState(session.class_started_at || null);
  const [endedAt, setEndedAt] = useState(session.ended_at || null);
  const [endedAutomatically, setEndedAutomatically] = useState(Boolean(session.ended_automatically));
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [rosterPage, setRosterPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [paymentInProgress, setPaymentInProgress] = useState(false);
  const scanInput = useRef(null);
  const scanning = useRef(false);
  const load = useCallback(async () => {
    const result = await api.sessions.attendance(session.session_id);
    setRows(result.attendees);
    setStatus(result.session.status);
    setRegisterOpenedAt(result.session.register_opened_at);
    setClassStartedAt(result.session.class_started_at);
    setEndedAt(result.session.ended_at);
    setEndedAutomatically(Boolean(result.session.ended_automatically));
  }, [session.session_id]);
  const exportAttendance = async () => {
    try {
      const result = await api.sessions.exportAttendancePDF(session.session_id);
      if (!result.canceled) notify("Session attendance report exported as a PDF.");
    } catch (err) {
      notify(err.message, "error");
    }
  };
  useEffect(() => {
    load().catch((err) => notify(err.message, "error"));
  }, [load]);
  useEffect(() => {
    if (status === "ongoing") window.requestAnimationFrame(() => scanInput.current?.focus());
  }, [status]);
  const start = async () => {
    setBusy(true);
    try {
      await api.sessions.start(session.session_id);
      setStatus("ongoing");
      await load();
      refresh();
      notify("Session started. The attendance register is ready.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const mark = async (row, next) => {
    try {
      await api.sessions.mark({
        session_id: session.session_id,
        stid: row.stid,
        status: next,
      });
      await load();
      return true;
    } catch (err) {
      notify(err.message, "error");
      return false;
    }
  };
  const markAttendance = async (row, next) => {
    const marked = await mark(row, next);
    if (marked && next === "present") {
      notify(birthdayMessage(row, session.session_date) || `${row.name} marked present.`);
    }
  };
  const classStarted = async () => {
    setBusy(true);
    try {
      const timestamp = await api.sessions.classStarted(session.session_id);
      setClassStartedAt(timestamp);
      await load();
      refresh();
      notify(`Class started at ${prettyTimestamp(timestamp)}.`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const scanCard = async (value = query.trim()) => {
    if (!value || scanning.current) return;
    scanning.current = true;
    try {
      const student = await api.students.byRfid(value);
      if (!student) {
        notify("No active student has that RFID card.", "error");
        return;
      }
      const attendee = (rows || []).find((row) => row.stid === student.stid);
      if (!attendee) {
        notify(`${student.name} is not enrolled in this class.`, "error");
        return;
      }
      setSelectedStudentId(attendee.stid);
      if (status !== "ongoing") {
        notify(
          `${student.name} is on the register. Start the session to mark attendance.`,
        );
        return;
      }
      if (attendee.status !== "present") {
        await markAttendance(attendee, "present");
      } else if (attendee.status === "present") {
        notify(`${student.name} is already marked present.`);
      }
      setQuery("");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setQuery("");
      scanning.current = false;
      window.requestAnimationFrame(() => scanInput.current?.focus());
    }
  };
  const pay = (row) => {
    if (paymentInProgress) return;
    if (status !== "ongoing" || row.status !== "present") {
      notify(
        "Mark the student present in an open session before collecting payment.",
        "error",
      );
      return;
    }
    if (!row.enrollment_id) {
      notify("This student has no active enrollment for this class.", "error");
      return;
    }
    setPaymentInProgress(true);
    setModal({
      type: "payment-review",
      rows: [{
        ...row,
        due_amount: Number(row.fee) * (1 - Number(row.discount_percentage || 0) / 100),
        class_name: session.class_name,
      }],
      month: thisMonth(),
      session_id: session.session_id,
      session,
    });
  };
  const end = async () => {
    if (
      !window.confirm(
        "End this session? Any students not yet marked will be recorded as absent.",
      )
    )
      return;
    setBusy(true);
    try {
      await api.sessions.end(session.session_id);
      setStatus("completed");
      await load();
      refresh();
      notify("Session complete. Unmarked students were recorded as absent.");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const filtered = (rows || []).filter((row) =>
    `${row.name} ${row.rfid || ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const visibleFiltered = pageSlice(filtered, rosterPage);
  useEffect(() => setRosterPage(1), [query]);
  const selectedStudent =
    (rows || []).find((row) => row.stid === selectedStudentId) ||
    (rows || [])[0] ||
    null;
  return (
    <>
      <ModalTitle
        eyebrow={prettyDate(session.session_date)}
        title={session.class_name}
        description={`${session.subject || "Class session"}${session.start_time ? ` · ${session.start_time}` : ""}${session.end_time ? `–${session.end_time}` : ""}`}
        action={
          status === "scheduled" ? (
            <Button onClick={start} disabled={busy}>Start session</Button>
          ) : status === "ongoing" ? (
            <div className="session-header-actions">
              {!classStartedAt && <Button onClick={classStarted} disabled={busy}>Class Started</Button>}
              <Button kind="secondary" onClick={end} disabled={busy}>
                End session <CheckCheck size={15} />
              </Button>
            </div>
          ) : null
        }
        className="session-modal-title"
        close={close}
      />
      <div className="session-modal-content">
        {status === "completed" && endedAutomatically ? (
          <div className="session-auto-ended-banner" role="status">
            <b>This session was ended automatically.</b>
            <span>Please end the session after class; do not wait for the system to close it.</span>
          </div>
        ) : status === "completed" && (
          <div className="session-complete-banner">
            <CheckCheck size={16} />
            {endedAt
              ? `This session ended at ${prettyTimestamp(endedAt)}. The register is read-only.`
              : "This session is complete. The register is read-only."}
          </div>
        )}
        <div className="session-roster-top">
          <div>
            <b>Attendance register</b>
            <span>
              {rows?.filter((row) => row.status === "present").length || 0} of{" "}
              {rows?.length || 0} present
            </span>
          </div>
          <div className="session-register-actions">
            {classStartedAt && <span className="session-started-time">Class started at {prettyTimestamp(classStartedAt)}</span>}
            <div className="table-search">
              <Search size={15} />
              <input
                ref={scanInput}
                placeholder="Search name or scan RFID…"
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                  const scannedStudent = (rows || []).find(
                    (row) =>
                      row.rfid &&
                      row.rfid.trim().toLowerCase() === value.trim().toLowerCase(),
                  );
                  if (scannedStudent && status === "ongoing") scanCard(value.trim());
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    scanCard();
                  }
                }}
              />
            </div>
            <Button kind="secondary" icon={Download} onClick={exportAttendance} disabled={!rows}>
              Export PDF
            </Button>
          </div>
        </div>
        <div className="session-attendance-layout">
          <div className="session-roster-column">
            <div className="session-roster-heading">
              <b>Students</b>
              <span>{filtered.length} shown</span>
            </div>
            {rows?.length ? (
              <div className="session-roster">
                {filtered.length ? visibleFiltered.map((row) => (
                  <button
                    className={`session-student ${selectedStudent?.stid === row.stid ? "session-student-selected" : ""}`}
                    key={row.stid}
                    onClick={() => setSelectedStudentId(row.stid)}
                  >
                    <StudentAvatar stid={row.stid} name={row.name} version={version} />
                    <div className="session-student-name">
                      <b>{row.name}</b>
                      <span>{row.rfid ? `Card ${row.rfid}` : "No card assigned"}</span>
                      {Number(row.discount_percentage) >= 100 && <span className="free-access-label">Free Access student</span>}
                      {Number(row.recent_absence_count) === 2 && <span className="low-attendance-label">Absent for the last 2 sessions</span>}
                    </div>
                    <div className="session-student-attendance">
                      <Status value={row.status} />
                      {row.status === "present" && row.present_at && (
                        <span className={`session-student-arrival${Number(row.late_minutes) > 0 ? " late" : ""}`}>
                          {prettyTimestamp(row.present_at)}
                          {classStartedAt && (Number(row.late_minutes) > 0
                            ? ` · ${row.late_minutes} min late`
                            : " · On time")}
                        </span>
                      )}
                    </div>
                  </button>
                )) : <div className="session-no-roster">No students match this name or RFID.</div>}
              </div>
            ) : (
              <div className="session-no-roster">
                <Users size={19} />
                <span>
                  {status === "scheduled"
                    ? "Start the session to prepare the attendance register."
                    : "No active students are enrolled in this class."}
                </span>
              </div>
            )}
            {rows?.length > 0 && (
              <Pagination count={filtered.length} page={rosterPage} setPage={setRosterPage} />
            )}
          </div>
          <aside className={`session-student-detail${selectedStudent?.status === "present" ? " session-student-detail-present" : ""}`}>
            {selectedStudent ? (
              <>
                <div className="session-detail-person">
                  <StudentAvatar
                    stid={selectedStudent.stid}
                    name={selectedStudent.name}
                    version={version}
                    className="session-detail-photo"
                  />
                  <div>
                    <span>Selected student</span>
                    <h3>{selectedStudent.name}</h3>
                    <div className="session-detail-identity">
                      <span>{selectedStudent.school || "School not added"}</span>
                      <span>RFID · {selectedStudent.rfid || "Not assigned"}</span>
                    </div>
                    <Status value={selectedStudent.status} />
                    {selectedStudent.status === "present" && birthdayMessage(selectedStudent, session.session_date) && (
                      <div className="birthday-attendance-notice" role="status">
                        {birthdayMessage(selectedStudent, session.session_date)}
                      </div>
                    )}
                    {Number(selectedStudent.discount_percentage) >= 100 && <span className="free-access-label">Free Access student</span>}
                    {Number(selectedStudent.recent_absence_count) === 2 && (
                      <div className="low-attendance-notice" role="status">
                        <b>Low attendance</b>
                        <span>This student was absent for the last 2 sessions.</span>
                      </div>
                    )}
                    {selectedStudent.status === "present" && selectedStudent.present_at && (
                      <span className={`session-student-arrival${Number(selectedStudent.late_minutes) > 0 ? " late" : ""}`}>
                        Arrived at {prettyTimestamp(selectedStudent.present_at)}
                        {classStartedAt && (Number(selectedStudent.late_minutes) > 0
                          ? ` · ${selectedStudent.late_minutes} minute${Number(selectedStudent.late_minutes) === 1 ? "" : "s"} late`
                          : " · On time")}
                      </span>
                    )}
                  </div>
                </div>
                {Number(selectedStudent.overdue_month_count) > 0 && (
                  <div className="payment-overdue-notice" role="status">
                    <b>Not paid yet</b>
                    <span>
                      {selectedStudent.overdue_month_count} month{Number(selectedStudent.overdue_month_count) === 1 ? "" : "s"} need{Number(selectedStudent.overdue_month_count) === 1 ? "s" : ""} to be paid. Attendance can still be marked.
                    </span>
                    {status === "ongoing" && selectedStudent.status === "present" && (
                      <div className="payment-overdue-actions">
                        {selectedStudent.overdue_months.map(({ month }) => {
                          const monthName = new Date(`${month}-02T00:00:00`).toLocaleDateString(undefined, {
                            month: "long",
                            year: "numeric",
                          });
                          return (
                            <Button
                              key={month}
                              kind="secondary"
                              onClick={() => setModal({
                                type: "payment-review",
                                rows: [{
                                  ...selectedStudent,
                                  class_name: session.class_name,
                                  due_amount: Number(selectedStudent.fee) * (1 - Number(selectedStudent.discount_percentage || 0) / 100),
                                }],
                                month,
                                session_id: session.session_id,
                                session,
                              })}
                            >
                              Paid for {monthName}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="session-detail-actions">
                  {status === "ongoing" && (
                  <Button
                    onClick={() => markAttendance(
                      selectedStudent,
                      selectedStudent.status === "present" ? "absent" : "present",
                    )}
                    disabled={busy}
                  >
                      <Check size={16} />
                      {selectedStudent.status === "present" ? "Mark absent" : "Mark present"}
                    </Button>
                  )}
                  {status === "ongoing" && selectedStudent.status === "present" && (
                    Number(selectedStudent.discount_percentage) >= 100 ? (
                      <span className="free-access-label">Free Access</span>
                    ) : (selectedStudent.payment_id || !selectedStudent.overdue_months?.some(({ month }) => month === thisMonth())) && (
                    <Button
                      kind={selectedStudent.payment_id ? "secondary" : "alert"}
                      onClick={() => !selectedStudent.payment_id && pay(selectedStudent)}
                      disabled={
                        Boolean(selectedStudent.payment_id) ||
                        !selectedStudent.enrollment_id ||
                        paymentInProgress
                      }
                    >
                      {selectedStudent.payment_id ? <Check size={16} /> : <CreditCard size={16} />}
                      {paymentInProgress
                        ? "Saving payment…"
                        : selectedStudent.payment_id
                          ? "Paid this month"
                          : `Mark as Paid ${money(selectedStudent.fee * (1 - (selectedStudent.discount_percentage || 0) / 100))}`}
                    </Button>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="session-detail-empty">
                <Users size={24} />
                <b>Student details</b>
                <span>Select a student from the register or scan their RFID card.</span>
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function TeacherOpeningBalanceForm({ close, finish, notify }) {
  const { data: teachers } = useLoad(() => api.teachers.list(), []);
  const { data: balances } = useLoad(() => api.reports.teacherBalances(), []);
  const [form, setForm] = useState({ tid: "", amount: "0", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedBalance = (balances || []).find(row => String(row.tid) === form.tid);
  const changeTeacher = (event) => {
    const tid = event.target.value;
    const current = (balances || []).find(row => String(row.tid) === tid);
    setForm({ ...form, tid, amount: current ? String(current.opening_balance) : "0" });
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.payouts.setOpeningBalance({
        tid: Number(form.tid),
        amount: Number(form.amount),
        notes: form.notes
      });
      notify("Teacher opening balance saved.");
      finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="TEACHER PAYMENTS"
        title="Set opening balance"
        description="Enter the amount already owed to this teacher when you started using Tuition Manager. Saving replaces the previous opening amount."
        close={close}
      />
      <form className="modal-form" onSubmit={save}>
        <SelectField
          label="Teacher"
          required
          value={form.tid}
          onChange={changeTeacher}
          options={[
            { value: "", label: "Choose a teacher" },
            ...(teachers || []).map(teacher => ({ value: String(teacher.tid), label: teacher.name }))
          ]}
        />
        {form.tid && (
          <div className="payment-review-row">
            <div><b>Current opening balance</b><span>{selectedBalance ? money(selectedBalance.opening_balance) : money(0)}</span></div>
          </div>
        )}
        <Field label="Opening amount" required>
          <input
            type="number"
            min="0"
            max="1000000000000"
            step="0.01"
            value={form.amount}
            onChange={event => setForm({ ...form, amount: event.target.value })}
            placeholder="0.00"
            required
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={form.notes}
            maxLength={500}
            onChange={event => setForm({ ...form, notes: event.target.value })}
            placeholder="Optional opening-balance details"
          />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <ModalActions close={close} saving={saving} label="Save opening balance" />
      </form>
    </>
  );
}

function PayoutForm({ close, finish, notify }) {
  const { data: teachers } = useLoad(() => api.teachers.list(), []);
  const { data: classes } = useLoad(() => api.classes.list(), []);
  const [form, setForm] = useState({
    tid: "",
    amount: "",
    payout_date: today(),
    notes: "",
    details: [],
  });
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [classQuery, setClassQuery] = useState("");
  const [classPage, setClassPage] = useState(1);
  const ownClasses = (classes || []).filter(
    (item) => String(item.tid) === form.tid,
  );
  const matchingClasses = ownClasses.filter((item) =>
    item.class_name.toLowerCase().includes(classQuery.toLowerCase()),
  );
  const change = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  const submit = (event) => {
    event.preventDefault();
    setError("");
    setReview(true);
  };
  const recordPayout = async () => {
    setSaving(true);
    setError("");
    try {
      await api.payouts.add({
        ...form,
        tid: Number(form.tid),
        amount: Number(form.amount),
        details: form.details,
      });
      notify("Teacher payout recorded.");
      finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="TEACHER PAYMENTS"
        title={review ? "Review teacher payout" : "Record a payout"}
        description={review ? "Check the teacher, amount, date and class details before recording." : "Keep a clear record of the payments you make to teachers."}
        close={close}
      />
      <form className="modal-form" onSubmit={submit}>
        {review ? (
          <div className="payment-review-content payout-review">
            <div className="payment-review-row"><div><b>Teacher</b><span>{(teachers || []).find((teacher) => String(teacher.tid) === form.tid)?.name || "—"}</span></div></div>
            <div className="payment-review-row"><div><b>Payment date</b><span>{prettyDate(form.payout_date)}</span></div><b>{money(form.amount)}</b></div>
            {form.details.map((detail) => {
              const className = ownClasses.find((item) => item.class_id === detail.class_id)?.class_name || "Class";
              return <div className="payment-review-row" key={detail.class_id}><div><b>{className}</b><span>{detail.for_month}</span></div><b>{money(detail.amount_for_class)}</b></div>;
            })}
            {form.notes && <div className="payment-review-row"><div><b>Notes</b><span>{form.notes}</span></div></div>}
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <Button kind="secondary" onClick={() => setReview(false)} disabled={saving}>Revise payout</Button>
              <Button onClick={recordPayout} disabled={saving}>{saving ? "Recording…" : "Confirm and record"}<Check size={15} /></Button>
            </div>
          </div>
        ) : (
          <>
        <SelectField
          label="Teacher"
          required
          value={form.tid}
          onChange={change("tid")}
          options={[
            { value: "", label: "Choose a teacher" },
            ...(teachers || []).map((t) => ({
              value: String(t.tid),
              label: t.name,
            })),
          ]}
        />
        <div className="form-two">
          <Field
            label="Amount paid"
            required
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={change("amount")}
            placeholder="0.00"
          />
          <Field
            label="Payment date"
            required
            type="date"
            value={form.payout_date}
            onChange={change("payout_date")}
          />
        </div>
        {ownClasses.length > 0 && (
          <div className="payout-class-picker">
            <span className="field-label">
              Optional: which class / month does this cover?
            </span>
            <div className="table-search enrollment-search">
              <Search size={15} />
              <input
                aria-label="Search payout classes"
                placeholder="Search classes…"
                value={classQuery}
                onChange={(event) => {
                  setClassQuery(event.target.value);
                  setClassPage(1);
                }}
              />
            </div>
            {pageSlice(matchingClasses, classPage).map((item) => {
              const existing = form.details.find(
                (d) => d.class_id === item.class_id,
              );
              return (
                <div className="payout-class-row" key={item.class_id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(existing)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          details: event.target.checked
                            ? [
                                ...form.details,
                                {
                                  class_id: item.class_id,
                                  amount_for_class: 0,
                                  for_month: thisMonth(),
                                },
                              ]
                            : form.details.filter(
                                (d) => d.class_id !== item.class_id,
                              ),
                        })
                      }
                    />
                    {item.class_name}
                  </label>
                  {existing && (
                    <>
                      <input
                        type="month"
                        aria-label={`Month for ${item.class_name}`}
                        value={existing.for_month}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            details: form.details.map((d) =>
                              d.class_id === item.class_id
                                ? { ...d, for_month: event.target.value }
                                : d,
                            ),
                          })
                        }
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Payout amount for ${item.class_name}`}
                        placeholder="Amount"
                        value={existing.amount_for_class || ""}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            details: form.details.map((d) =>
                              d.class_id === item.class_id
                                ? {
                                    ...d,
                                    amount_for_class: Number(
                                      event.target.value,
                                    ),
                                  }
                                : d,
                            ),
                          })
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
            {matchingClasses.length > 0 && (
              <Pagination count={matchingClasses.length} page={classPage} setPage={setClassPage} />
            )}
            {classQuery && matchingClasses.length === 0 && (
              <p className="roster-empty">No class matches this search.</p>
            )}
          </div>
        )}
        <Field
          label="Notes"
          value={form.notes}
          onChange={change("notes")}
          placeholder="Optional payment reference"
        />
        {error && <div className="form-error">{error}</div>}
        <ModalActions close={close} saving={saving} label="Review payout" />
          </>
        )}
      </form>
    </>
  );
}
function HallForm({ hall, close, finish, notify }) {
  const [name, setName] = useState(hall?.name || "");
  const [capacity, setCapacity] = useState(hall?.capacity || "");
  const [availability, setAvailability] = useState(() => hall?.availability || weekdays.map((day) => ({
    day_of_week: day,
    start_time: "07:00",
    end_time: "23:00",
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setSlot = (index, key, value) =>
    setAvailability((slots) =>
      slots.map((slot, i) => (i === index ? { ...slot, [key]: value } : slot)),
    );
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.halls.save({
        hall_id: hall?.hall_id,
        name,
        capacity: capacity ? Number(capacity) : null,
        availability,
      });
      notify(
        hall
          ? "Hall availability updated."
          : "Hall added with weekly availability.",
      );
      finish();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${hall.name}?`)) return;
    setSaving(true);
    try {
      await api.halls.delete(hall.hall_id);
      notify("Hall deleted.");
      finish();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };
  return (
    <>
      <ModalTitle
        eyebrow="ROOMS & TIMETABLES"
        title={hall ? "Edit hall availability" : "Add a hall"}
        description="Set when this room is open. Classes can only be scheduled during these times."
        close={close}
      />
      <form className="modal-form modal-form-scroll" onSubmit={submit}>
        <Field
          label="Hall name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Main classroom"
        />
        <Field
          label="Seating capacity"
          type="number"
          min="1"
          step="1"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          placeholder="Optional"
        />
        <div className="schedule-editor hall-availability-editor">
          <div className="schedule-heading">
            <div>
              <b>Weekly availability</b>
              <span>Add every day and time this hall is open.</span>
            </div>
            <button
              type="button"
              className="text-link"
              onClick={() =>
                setAvailability((slots) => [
                  ...slots,
                  {
                    day_of_week: "monday",
                    start_time: "09:00",
                    end_time: "12:00",
                  },
                ])
              }
            >
              <Plus size={14} /> Add time
            </button>
          </div>
          {availability.map((slot, index) => (
            <div className="schedule-row" key={slot.availability_id || index}>
              <select
                aria-label="Available day"
                value={slot.day_of_week}
                onChange={(event) =>
                  setSlot(index, "day_of_week", event.target.value)
                }
              >
                {weekdays.map((day) => (
                  <option value={day} key={day}>
                    {day[0].toUpperCase() + day.slice(1)}
                  </option>
                ))}
              </select>
              <input
                aria-label="Available from"
                type="time"
                value={slot.start_time}
                onChange={(event) =>
                  setSlot(index, "start_time", event.target.value)
                }
              />
              <span>to</span>
              <input
                aria-label="Available until"
                type="time"
                value={slot.end_time}
                onChange={(event) =>
                  setSlot(index, "end_time", event.target.value)
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove availability"
                onClick={() =>
                  setAvailability((slots) =>
                    slots.filter((_, i) => i !== index),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {!availability.length && (
            <p className="roster-empty">
              No availability added yet. A hall needs available times before a
              class can use it.
            </p>
          )}
        </div>
        {hall?.class_count > 0 && (
          <div className="hall-assignment-note">
            <BookOpen size={15} />
            <span>
              This hall is assigned to {hall.class_count} class
              {hall.class_count === 1 ? "" : "es"}. Availability changes must
              continue to cover all their class times.
            </span>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {hall && (
            <button
              type="button"
              className="button button-danger-text"
              onClick={remove}
              disabled={saving}
            >
              Delete hall
            </button>
          )}
          <span className="action-spacer" />
          <Button kind="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : hall ? "Save hall" : "Add hall"}
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </>
  );
}
function PageJump({ page, close, navigate }) {
  useEffect(() => {
    navigate(page);
    close();
  }, []);
  return null;
}

export default App;
