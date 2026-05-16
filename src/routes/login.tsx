import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { authService } from "@/services/authService";
import { toast } from "sonner";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@jungle.local");
  const [pw, setPw] = useState("admin1234");
  const [username, setUsername] = useState("mary");
  const [pin, setPin] = useState("2468");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authService.signOut().catch(() => {});
  }, []);

  const signInEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authService.signInWithEmail(email, pw);
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid local login");
    } finally {
      setBusy(false);
    }
  };

  const signInPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || pin.length < 4) {
      toast.error("Enter username and PIN");
      return;
    }
    setBusy(true);
    try {
      await authService.signInWithPin(username, pin);
      navigate({ to: "/dashboard" });
    } catch {
      toast.error("Invalid username or PIN");
    } finally {
      setBusy(false);
    }
  };

  const pinPad = (n: string) => setPin((p) => (p.length < 6 ? p + n : p));

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-6">
        <div className="flex flex-col items-center mb-6">
          <img src={logo} alt="Jungle Pepper" width={80} height={80} />
          <h1 className="text-2xl font-bold mt-3">Jungle Pepper</h1>
          <p className="text-sm text-muted-foreground">Inventory & POS</p>
        </div>

        <Tabs defaultValue="pin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pin">Staff PIN</TabsTrigger>
            <TabsTrigger value="email">Admin Email</TabsTrigger>
          </TabsList>

          <TabsContent value="pin">
            <form onSubmit={signInPin} className="space-y-4 mt-4">
              <div>
                <Label htmlFor="u">Username</Label>
                <Input
                  id="u"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div>
                <Label>PIN</Label>
                <div className="text-center text-3xl tracking-[0.5em] font-mono py-2 my-1 border border-border rounded-md bg-input">
                  {pin
                    .padEnd(4, "*")
                    .split("")
                    .map((c, i) => (
                      <span key={i}>{c ? "*" : ""}</span>
                    ))}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant="secondary"
                      onClick={() => pinPad(n)}
                      className="h-12 text-lg"
                    >
                      {n}
                    </Button>
                  ))}
                  <Button type="button" variant="ghost" onClick={() => setPin("")} className="h-12">
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => pinPad("0")}
                    className="h-12 text-lg"
                  >
                    0
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPin((p) => p.slice(0, -1))}
                    className="h-12"
                  >
                    Back
                  </Button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Sign in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="email">
            <form onSubmit={signInEmail} className="space-y-4 mt-4">
              <div>
                <Label htmlFor="e">Email</Label>
                <Input
                  id="e"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <Label htmlFor="p">Password</Label>
                <Input
                  id="p"
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Sign in
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Sign in with a Supabase staff account.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
