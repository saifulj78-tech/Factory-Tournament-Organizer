import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import TournamentList from "@/pages/tournament-list";
import Dashboard from "@/pages/dashboard";
import Settings from "@/pages/settings";
import Groups from "@/pages/groups";
import Matches from "@/pages/matches";
import Standings from "@/pages/standings";
import Spectator from "@/pages/spectator";
import NotFound from "@/pages/not-found";

// REQUIRED — copy verbatim per Clerk skill
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev (intentional), auto-set in prod
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#eab308", // yellow-500
    colorForeground: "#fefce8", // yellow-50
    colorMutedForeground: "#fca5a5", // red-300
    colorDanger: "#ef4444",
    colorBackground: "#170202", // very dark red
    colorInput: "#2a0404",
    colorInputForeground: "#fefce8",
    colorNeutral: "#450a0a",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.25rem", // making it slightly more angular for the armored look
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-red-950 rounded-lg w-[440px] max-w-full overflow-hidden border border-red-900 shadow-[0_0_30px_rgba(234,179,8,0.1)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-yellow-500 font-black display-font uppercase tracking-wider text-3xl",
    headerSubtitle: "text-red-300",
    socialButtonsBlockButtonText: "text-red-100",
    formFieldLabel: "text-red-200 font-bold uppercase text-xs tracking-wider",
    footerActionLink: "text-yellow-500 hover:text-yellow-400",
    footerActionText: "text-red-300",
    dividerText: "text-red-400",
    identityPreviewEditButton: "text-yellow-500",
    formFieldSuccessText: "text-yellow-500",
    alertText: "text-red-100",
    logoBox: "flex justify-center",
    logoImage: "h-12 w-12 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]",
    socialButtonsBlockButton: "border border-red-800 bg-red-950 hover:bg-red-900",
    formButtonPrimary: "bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-red-950 font-black uppercase tracking-wider rounded border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]",
    formFieldInput: "bg-red-950 border-red-800 text-red-50 focus:border-yellow-500 focus:ring-yellow-500/20",
    footerAction: "border-t border-red-900 bg-red-950/50",
    dividerLine: "bg-red-900",
    alert: "bg-red-950 border-red-800",
    otpCodeFieldInput: "bg-red-950 border-red-800 text-red-50",
    formFieldRow: "",
    main: "",
    // Hide the sign-up link — accounts are created manually by the admin
    footerAction__signUp: "hidden",
  },
};

const queryClient = new QueryClient();

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0000] px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(234,179,8,0.05)_0%,transparent_60%)] pointer-events-none" />
      <div className="w-full max-w-md space-y-6 relative z-10">
        <div className="text-center">
          <p className="text-red-500/60 font-bold text-xs uppercase tracking-widest display-font text-lg">Control Room</p>
        </div>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-in`}
        />
        <p className="text-center text-xs font-bold uppercase tracking-wider text-red-500/50">
          Contact your administrator to get access.
        </p>
      </div>
    </div>
  );
}


function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function TournamentRoute({ path, component: Component }: { path: string; component: React.ComponentType }) {
  return (
    <Route path={path}>
      {(params: { id: string }) => (
        <>
          <Show when="signed-in">
            <Layout tournamentId={Number(params.id)}>
              <Component />
            </Layout>
          </Show>
          <Show when="signed-out">
            <Redirect to="/sign-in" />
          </Show>
        </>
      )}
    </Route>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsub;
  }, [addListener, qc]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={TournamentList} />} />
      <Route path="/sign-in/*?" component={SignInPage} />
      {/* Spectator is always public */}
      <Route path="/spectator/:id" component={Spectator} />
      <TournamentRoute path="/tournaments/:id" component={Dashboard} />
      <TournamentRoute path="/tournaments/:id/settings" component={Settings} />
      <TournamentRoute path="/tournaments/:id/groups" component={Groups} />
      <TournamentRoute path="/tournaments/:id/matches" component={Matches} />
      <TournamentRoute path="/tournaments/:id/standings" component={Standings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-in`}
      localization={{
        signIn: {
          start: {
            title: "Tourney Manager",
            subtitle: "Sign in to manage your tournaments",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;