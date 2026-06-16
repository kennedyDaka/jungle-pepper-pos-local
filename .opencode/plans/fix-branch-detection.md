# Fix: Branch Detection for Waiter & Pending Orders

## Problem
The waiter tab shows "No branch found" and the POS PendingOrdersDialog shows nothing because both query `branch_memberships` for the user's branch. Users (especially admins) who don't have an **active** `branch_memberships` record get `null` for `branchId`.

## Root Cause
- `waiter.tsx:120-131` — queries `branch_memberships` with `.eq("active", true)`. If the user has no active membership, `branchId` is null → "No branch found" shown.
- `pos.tsx:239-262` (PendingOrdersDialog) — same query pattern. When `branchId` is null, the `pendingOrders` query is disabled (`enabled: !!branchId`).

The `create_waiter_order` RPC and `can_access_branch` function both handle admins without memberships, but the frontend never reaches them.

## Changes

### 1. `src/routes/_app/waiter.tsx` — Replace membership query (lines 120-131)

**Old:**
```typescript
const membership = useQuery({
    queryKey: ["auth", "branch-membership"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data as { branch_id: string; branches: { id: string; name: string } } | null;
    },
  });
```

**New:**
```typescript
const membership = useQuery({
    queryKey: ["auth", "branch-membership"],
    queryFn: async () => {
      const { data: membershipData, error: membershipError } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membershipData) return membershipData;
      const { data: branchData, error: branchError } = await supabase
        .from("branches")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branchData) return null;
      return { branch_id: branchData.id, branches: { id: branchData.id, name: branchData.name } };
    },
  });
```

### 2. `src/routes/_app/pos.tsx` — Replace branchMemberships query in PendingOrdersDialog (lines 239-250)

**Old:**
```typescript
const branchMemberships = useQuery({
    queryKey: ["auth", "branch-memberships"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data as { branch_id: string; branches: { id: string; name: string } } | null;
    },
  });
```

**New:**
```typescript
const branchMemberships = useQuery({
    queryKey: ["auth", "branch-memberships"],
    queryFn: async () => {
      const { data: membershipData, error: membershipError } = await supabase
        .from("branch_memberships")
        .select("branch_id, branches!inner(id, name)")
        .eq("active", true)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (membershipData) return membershipData;
      const { data: branchData, error: branchError } = await supabase
        .from("branches")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branchData) return null;
      return { branch_id: branchData.id, branches: { id: branchData.id, name: branchData.name } };
    },
  });
```

## Why this works
- Step 1: Try `branch_memberships` — works for cashiers explicitly assigned to a branch
- Step 2 (fallback): Query `branches` for the first active branch — works for admins/cashiers without a membership record, since the `branches` RLS policy "branches staff read" allows SELECT by authenticated staff (`is_staff` returns true for admin/cashier/storekeeper roles)
- Both steps use `.maybeSingle()` so `null` is returned gracefully if no branch exists at all

## Verification
After applying both changes:
1. Log in as a user with admin/cashier role
2. Navigate to Waiter tab — should load the menu instead of showing "No branch found"
3. Open PendingOrdersDialog in POS — should show pending orders (or "No pending orders" if none exist)
