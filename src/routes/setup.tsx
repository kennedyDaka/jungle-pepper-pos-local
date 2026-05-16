import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { authService } from "@/services/authService";
import { toast } from "sonner";
import logo from "@/assets/jungle-pepper-logo.png";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@jungle.local");
  const [pw, setPw] = useState("admin1234");
  const [name, setName] = useState("Local Admin");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authService.createFirstAdmin({ email, password: pw, fullName: name || email });
      toast.success("Local admin ready. Please sign in.");
      navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create Supabase admin");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-6">
        <div className="flex flex-col items-center mb-6">
          <img src={logo} alt="Jungle Pepper" width={72} height={72} />
          <h1 className="text-xl font-bold mt-3">Create Supabase admin</h1>
          <p className="text-xs text-muted-foreground text-center">
            This creates a staff account in Supabase Auth when project policies allow it.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            Save Supabase admin
          </Button>
        </form>
      </Card>
    </div>
  );
}
