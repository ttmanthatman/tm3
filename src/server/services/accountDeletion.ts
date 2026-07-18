export type AccountDeletionInput = {
  currentAccountId: number;
  targetAccountId: number;
};

export type AccountDeletionResult =
  | {
      deleted: true;
      accountId: number;
      sessionIds: string[];
      channelIds: number[];
    }
  | {
      deleted: false;
      reason: "invalid-account-id" | "current-account" | "account-not-found" | "last-admin";
    };

type AccountDeletionRecord = {
  id: number;
  displayName: string;
  role: "admin" | "user";
  actor: { id: number } | null;
  sessions: Array<{ id: string }>;
  memberships: Array<{ channelId: number }>;
};

export type AccountDeletionTransaction = {
  account: {
    findUnique(args: {
      where: { id: number };
      include: {
        actor: true;
        sessions: { select: { id: true } };
        memberships: { select: { channelId: true } };
      };
    }): Promise<AccountDeletionRecord | null>;
    count(args: { where: { role: "admin"; id: { not: number } } }): Promise<number>;
    delete(args: { where: { id: number } }): Promise<unknown>;
  };
  actor: {
    update(args: {
      where: { id: number };
      data: {
        accountId: null;
        username: string;
        displayName: string;
        avatarPath: null;
        status: "deleted";
      };
    }): Promise<unknown>;
  };
};

export type AccountDeletionDependencies = {
  runTransaction<T>(operation: (tx: AccountDeletionTransaction) => Promise<T>): Promise<T>;
};

export async function deleteAccount(
  deps: AccountDeletionDependencies,
  input: AccountDeletionInput
): Promise<AccountDeletionResult> {
  const { currentAccountId, targetAccountId } = input;
  if (!Number.isInteger(targetAccountId) || targetAccountId < 1) {
    return { deleted: false, reason: "invalid-account-id" };
  }
  if (targetAccountId === currentAccountId) {
    return { deleted: false, reason: "current-account" };
  }

  return deps.runTransaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { id: targetAccountId },
      include: {
        actor: true,
        sessions: { select: { id: true } },
        memberships: { select: { channelId: true } }
      }
    });
    if (!account) return { deleted: false, reason: "account-not-found" };

    if (account.role === "admin") {
      const otherAdmins = await tx.account.count({
        where: { role: "admin", id: { not: targetAccountId } }
      });
      if (!otherAdmins) return { deleted: false, reason: "last-admin" };
    }

    if (account.actor) {
      await tx.actor.update({
        where: { id: account.actor.id },
        data: {
          accountId: null,
          username: `deleted-account-${targetAccountId}`,
          displayName: `${account.displayName}（已删除用户）`,
          avatarPath: null,
          status: "deleted"
        }
      });
    }
    await tx.account.delete({ where: { id: targetAccountId } });

    return {
      deleted: true,
      accountId: targetAccountId,
      sessionIds: account.sessions.map((session) => session.id),
      channelIds: account.memberships.map((membership) => membership.channelId)
    };
  });
}
