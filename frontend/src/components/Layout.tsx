import { NavLink, Outlet } from "react-router";
import { kindList } from "../kinds";

export function Layout() {
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Bỏ qua điều hướng
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Thư viện mẫu – trang chủ">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect x="6" y="3" width="20" height="26" rx="2" fill="#fff" stroke="currentColor" strokeWidth="2" />
            <path d="M10 10h12M10 15h12M10 20h7" stroke="currentColor" strokeWidth="2" />
            <circle cx="22" cy="23" r="5" fill="var(--seal)" />
          </svg>
          <span>Thư viện mẫu</span>
        </NavLink>

        <nav aria-label="Điều hướng chính">
          <p className="nav__group">Thư viện</p>
          {kindList.map((k) => (
            <NavLink key={k.kind} to={k.path} className="nav__link">
              <KindIcon aspect={k.aspect} />
              {k.label}
            </NavLink>
          ))}
          <p className="nav__group">Của bạn</p>
          <NavLink to="/tai-lieu" className="nav__link">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <path d="M3 5h5l2 2h7v9H3z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            Tài liệu của tôi
          </NavLink>
        </nav>
      </aside>

      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function KindIcon({ aspect }: { aspect: "page" | "slide" }) {
  return aspect === "page" ? (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <rect x="4.5" y="2.5" width="11" height="15" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <rect x="2" y="4" width="16" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 14v3M7 17h6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
