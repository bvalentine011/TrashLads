import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { DataProvider } from "./data/DataContext";
import { DraftProvider } from "./data/draft";
import { createDemoSource } from "./data/demoSource";
import type { DataSource } from "./data/source";
import { Account } from "./screens/Account";
import { Book } from "./screens/Book";
import { Confirmation } from "./screens/Confirmation";
import { Help } from "./screens/Help";
import { Home } from "./screens/Home";
import { Owner } from "./screens/Owner";
import { OwnerSupport } from "./screens/OwnerSupport";
import { Pickups } from "./screens/Pickups";
import { Review } from "./screens/Review";
import { SignIn } from "./screens/SignIn";
import { AccountTerms, ServiceTerms } from "./screens/Terms";
import "./styles/app.css";

async function pickSource(): Promise<DataSource> {
  if (import.meta.env.VITE_DEMO_MODE === "true") return createDemoSource();
  // Loaded only in live builds, so the demo build doesn't pull in Firebase setup.
  const { createFirebaseSource } = await import("./data/firebaseSource");
  return createFirebaseSource();
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/signin", element: <SignIn /> },
      { path: "/book", element: <Book /> },
      { path: "/review", element: <RequireAuth><Review /></RequireAuth> },
      { path: "/confirmation/:id", element: <RequireAuth><Confirmation /></RequireAuth> },
      { path: "/pickups", element: <RequireAuth><Pickups /></RequireAuth> },
      { path: "/help", element: <Help /> },
      { path: "/account", element: <RequireAuth><Account /></RequireAuth> },
      { path: "/owner", element: <RequireAuth owner><Owner /></RequireAuth> },
      { path: "/owner/support", element: <RequireAuth owner><OwnerSupport /></RequireAuth> },
      { path: "/terms", element: <AccountTerms /> },
      { path: "/service-terms", element: <ServiceTerms /> },
      { path: "*", element: <div className="card empty"><p>Page not found</p><p><Link to="/">Go to the home page</Link></p></div> },
    ],
  },
]);

pickSource().then((source) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <DataProvider source={source}>
        <DraftProvider>
          <RouterProvider router={router} />
        </DraftProvider>
      </DataProvider>
    </StrictMode>,
  );
});
