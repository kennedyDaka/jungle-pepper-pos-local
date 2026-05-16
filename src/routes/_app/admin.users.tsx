import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/DataState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { authService } from "@/services/authService";

export const Route = createFileRoute("/_app/admin/users")({ component: UsersAdmin });

function UsersAdmin() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      return authService.listUsers();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Users</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New user
        </Button>
      </div>
      {list.isLoading && <LoadingState label="Loading live users..." />}
      {list.error && <ErrorState error={list.error} label="Could not load users" />}
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-2">Username</th>
              <th className="p-2">Full name</th>
              <th className="p-2">Role</th>
              <th className="p-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((u: any) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-2 font-medium">{u.username}</td>
                <td className="p-2">{u.full_name}</td>
                <td className="p-2 text-xs uppercase">{u.roles.join(", ")}</td>
                <td className="p-2">{u.active ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && (
        <NewUserDialog
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["users"] });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function NewUserDialog({ onClose, onSaved }: any) {
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"admin" | "cashier" | "storekeeper">("cashier");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const finalEmail = mode === "pin" ? `${username.toLowerCase()}@jungle.local` : email;
    const finalPw = mode === "pin" ? `pin-${pin}` : pw;
    if (mode === "pin" && (!username || pin.length < 4)) {
      setBusy(false);
      toast.error("Username and 4-6 digit PIN required");
      return;
    }
    if (mode === "email" && (!email || pw.length < 8)) {
      setBusy(false);
      toast.error("Email + 8-char password required");
      return;
    }
    await authService.createUser({
      email: finalEmail,
      password: finalPw,
      pin: mode === "pin" ? pin : undefined,
      username: username || finalEmail.split("@")[0],
      fullName: fullName || username || finalEmail,
      role,
    });
    setBusy(false);
    toast.success("User created");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "pin" ? "default" : "secondary"}
              onClick={() => setMode("pin")}
            >
              Username + PIN
            </Button>
            <Button
              size="sm"
              variant={mode === "email" ? "default" : "secondary"}
              onClick={() => setMode("email")}
            >
              Email login
            </Button>
          </div>
          <div>
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          {mode === "pin" ? (
            <>
              <div>
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, "").toLowerCase())}
                  placeholder="e.g. mary"
                />
              </div>
              <div>
                <Label>PIN (4-6 digits)</Label>
                <Input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier</SelectItem>
                <SelectItem value="storekeeper">Storekeeper</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
