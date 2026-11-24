export function formatAuthErrorMessage(
  err: unknown,
  currentHostname?: string,
  firebaseProjectId = 'boreal-genius-zmn89',
): string | null {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const message = err instanceof Error ? err.message : String(err || '');

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    message.includes('auth/popup-closed-by-user') ||
    message.includes('auth/cancelled-popup-request')
  ) {
    return null;
  }

  if (
    code === 'auth/unauthorized-domain' ||
    message.includes('auth/unauthorized-domain')
  ) {
    const host =
      currentHostname ||
      (typeof window !== 'undefined' ? window.location.hostname : 'domain ini');
    return [
      `Login Google diblokir karena domain "${host}" belum didaftarkan di Firebase Authentication (project: ${firebaseProjectId}).`,
      `Cara mengatasinya: Buka Firebase Console → Authentication → Settings → Authorized domains → klik Add domain → masukkan "${host}" (dan juga "ez-linguaflow-sus9.vercel.app").`,
    ].join('\n');
  }

  if (code === 'auth/popup-blocked' || message.includes('auth/popup-blocked')) {
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    return inIframe
      ? 'Pop-up login Google diblokir di mode pratinjau (iframe). Izinkan pop-up untuk situs ini di browser Anda, atau buka aplikasi di tab baru ("Open in new tab") lalu coba Sign in kembali.'
      : 'Pop-up login Google diblokir oleh browser Anda. Izinkan pop-up untuk situs ini lalu coba lagi.';
  }

  if (
    code === 'auth/network-request-failed' ||
    message.includes('auth/network-request-failed')
  ) {
    return 'Gangguan jaringan saat login Google. Periksa koneksi internet Anda lalu coba lagi.';
  }

  return message || 'Login Google gagal. Silakan coba lagi.';
}
