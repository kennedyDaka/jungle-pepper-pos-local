import { authService } from "@/services/authService";

export const usersService = {
  getSession: authService.getSession,
  getCurrentProfile: authService.getCurrentProfile,
  signInWithEmail: authService.signInWithEmail,
  signInWithPin: authService.signInWithPin,
  signOut: authService.signOut,
  listUsers: authService.listUsers,
  createUser: authService.createUser,
  createFirstAdmin: authService.createFirstAdmin,
};
