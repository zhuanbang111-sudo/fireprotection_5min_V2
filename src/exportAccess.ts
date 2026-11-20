interface ExportUser {
  email?: string;
  vip_level?: string;
  vip_expires_at?: string | null;
  isTrial?: boolean;
}

export function isAdministrator(user?: ExportUser | null): boolean {
  return !!user && !user.isTrial && (
    user.vip_level === 'admin' ||
    ['zhuanbang111@gmail.com', '714400040@qq.com', 'zhuanbang111@foxmail.com']
      .includes(user.email?.trim().toLowerCase() ?? '')
  );
}

export function hasActivePro(user?: ExportUser | null): boolean {
  return !!user && !user.isTrial && user.vip_level === 'pro' &&
    !!user.vip_expires_at && Date.parse(user.vip_expires_at) > Date.now();
}

export function canExportShapefile(user?: ExportUser | null): boolean {
  return isAdministrator(user) || hasActivePro(user);
}
