import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      tenantId: string;
      mustChangePassword: boolean;
    };
  }
  interface User {
    id: string;
    role: string;
    tenantId: string;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    tenantId: string;
    mustChangePassword: boolean;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: { tenant: { select: { id: true } } },
        });

        if (!user) return null;

        const passwordValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!passwordValid) return null;

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return {
          id:                 user.id,
          name:               user.name,
          email:              user.email,
          role:               user.role,
          tenantId:           user.tenantId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id                 = user.id;
        token.role               = user.role;
        token.tenantId           = user.tenantId;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id                 = token.id;
      session.user.role               = token.role;
      session.user.tenantId           = token.tenantId;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
  },
};
