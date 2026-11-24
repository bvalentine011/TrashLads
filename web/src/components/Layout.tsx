import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useData } from "../data/DataContext";
import { CalendarIcon, HelpIcon, HomeIcon, ListIcon, RouteIcon, UserIcon } from "./ui";

export function Layout() {
  const { data, user } = useData();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const links = user?.isOwner
    ? [
        { to: "/owner", label: "Route", Icon: RouteIcon },
        { to: "/owner/support", label: "Support", Icon: HelpIcon },
        { to: "/account", label: "Account", Icon: UserIcon },
      ]
    : [
        { to: "/", label: "Home", Icon: HomeIcon, end: true },
        { to: "/book", label: "Book", Icon: CalendarIcon },
        { to: "/pickups", label: "Pickups", Icon: ListIcon },
        { to: "/help", label: "Help", Icon: HelpIcon },
        user ? { to: "/account", label: "Account", Icon: UserIcon } : { to: "/signin", label: "Sign in", Icon: UserIcon },
      ];

  return (
    <>
      {data.mode === "demo" && <div className="demo-bar">Demo mode: sample data and pretend payments. Nothing is saved or charged.</div>}
      <header className="header">
        <div className="header-in">
          <NavLink to={user?.isOwner ? "/owner" : "/"} className="brand" aria-label="Trash Lads home">
            <img src="/logo.webp" alt="" width={44} height={44} />
            <div>
              <b>Trash Lads</b>
              <span>Weeknights 6–11 PM</span>
            </div>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {links.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end ?? to === "/owner"}>
                <Icon /> {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main" style={{ ["--tabs" as string]: links.length }}>
        {links.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end ?? to === "/owner"}>
            <Icon /> {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
