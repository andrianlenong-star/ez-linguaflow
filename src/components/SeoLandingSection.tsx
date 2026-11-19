import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  FileText,
  History,
  Image as ImageIcon,
  Languages,
  ListChecks,
  Mic,
} from 'lucide-react';
import type { NavView } from '../shared/types.ts';

export const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: 'Apa itu EduZone LinguaFlow?',
    answer:
      'EduZone LinguaFlow adalah aplikasi penerjemah berbasis AI (AI translator) yang membantu pengguna menerjemahkan teks, dokumen, gambar, dan suara dalam berbagai bahasa, serta dilengkapi kamus kontekstual, glossary khusus, dan riwayat penerjemahan.',
  },
  {
    question:
      'Format dokumen dan gambar apa saja yang didukung oleh EduZone LinguaFlow?',
    answer:
      'Untuk penerjemahan dokumen, EduZone LinguaFlow mendukung file .txt, .docx, .pptx, .pdf (termasuk PDF hasil pindai menggunakan OCR AI), dan .html hingga ukuran 15 MB. Untuk penerjemahan gambar, tersedia dukungan .png, .jpg, .jpeg, dan .webp hingga 10 MB.',
  },
  {
    question: 'Bagaimana cara kerja kamus kontekstual dan glossary khusus?',
    answer:
      'Anda dapat mengklik kata mana pun pada teks sumber atau hasil terjemahan untuk melihat arti kontekstual, definisi, dan contoh penggunaan di kamus online. Di menu Glossary, Anda dapat membuat daftar istilah khusus atau mengimpor/mengekspor file CSV agar terjemahan selalu konsisten dengan istilah yang Anda tentukan.',
  },
  {
    question:
      'Apakah EduZone LinguaFlow bisa menerjemahkan suara dan membacakan hasil terjemahan?',
    answer:
      'Ya. Melalui fitur Translate Voice, Anda dapat merekam suara langsung dari mikrofon atau mengunggah berkas audio untuk ditranskripsikan dan diterjemahkan, termasuk mode percakapan dua arah serta pemutaran suara Text-to-Speech (TTS).',
  },
  {
    question:
      'Apakah teks dan dokumen terjemahan saya disimpan di server atau diindeks Google?',
    answer:
      'Teks yang diterjemahkan diproses melalui API server tanpa disimpan permanen di server kami dan tidak diindeks oleh mesin pencari. Riwayat serta glossary tersimpan secara lokal di browser (IndexedDB), dan Anda dapat memilih opsi Sign in to Sync dengan akun Google untuk menyinkronkannya ke akun pribadi Anda.',
  },
  {
    question: 'Bahasa apa saja yang dapat diterjemahkan di EduZone LinguaFlow?',
    answer:
      'EduZone LinguaFlow menyediakan lebih dari 20 bahasa bawaan termasuk Bahasa Indonesia, Inggris, Jepang, Mandarin, Korea, Arab, Jerman, Prancis, Spanyol, Melayu, dan lainnya, serta fitur penambahan bahasa kustom sesuai kebutuhan pengguna.',
  },
];

interface SeoSectionProps {
  onNavigateView: (view: NavView) => void;
  onFocusTranslator: () => void;
}

export function SeoHeroHeader({ onFocusTranslator }: { onFocusTranslator: () => void }) {
  const [logoError, setLogoError] = useState(false);

  return (
    <section
      aria-labelledby="hero-title"
      className="mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6"
    >
      {/* Semantic Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <a
              href="https://ez-linguaflow-j4sf.vercel.app/"
              className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline"
            >
              Beranda
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-slate-700 dark:text-slate-200">
            Aplikasi Penerjemah AI EduZone LinguaFlow
          </li>
        </ol>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3.5 sm:gap-4 min-w-0 max-w-3xl">
          <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center">
            {logoError ? (
              <Languages className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            ) : (
              <img
                src="/assets/aistudio/IMG_20261112_191823_cec36c04.png"
                alt="Logo resmi EduZone LinguaFlow — Aplikasi Penerjemah AI Online"
                width={48}
                height={48}
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="w-12 h-12 object-cover"
              />
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <h1
              id="hero-title"
              className="text-xl sm:text-2xl lg:text-[1.65rem] font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-snug text-balance"
            >
              EduZone LinguaFlow — Aplikasi Penerjemah AI Online untuk Teks, Dokumen, Gambar &amp; Suara
            </h1>
            <p className="text-sm sm:text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
              Terjemahkan teks, dokumen PDF maupun DOCX, gambar, dan percakapan suara secara kontekstual.
              Dilengkapi kamus online, manajemen glossary istilah khusus, serta riwayat penerjemahan untuk pengguna Indonesia maupun internasional.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Penerjemah Online <span aria-hidden="true">·</span> Document &amp; PDF Translator{' '}
              <span aria-hidden="true">·</span> Image OCR Translator <span aria-hidden="true">·</span>{' '}
              Voice Translator &amp; TTS
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 shrink-0">
          <nav aria-label="Navigasi cepat halaman" className="flex items-center gap-4 text-xs font-medium text-slate-600 dark:text-slate-300">
            <a href="#fitur" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline whitespace-nowrap shrink-0">
              Fitur
            </a>
            <a href="#cara-pakai" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline whitespace-nowrap shrink-0">
              Cara Pakai
            </a>
            <a href="#faq" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline whitespace-nowrap shrink-0">
              FAQ
            </a>
          </nav>

          <button
            type="button"
            onClick={onFocusTranslator}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
          >
            <span>Mulai Terjemahkan Sekarang</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function SeoLandingSection({ onNavigateView, onFocusTranslator }: SeoSectionProps) {
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  const features: Array<{
    id: string;
    title: string;
    subtitle: string;
    description: string;
    ctaLabel: string;
    icon: typeof Languages;
    spanClass: string;
    action: () => void;
  }> = [
    {
      id: 'teks',
      title: 'Penerjemah Teks AI Kontekstual',
      subtitle: 'AI Text Translator · Nada & Profil Gaya',
      description:
        'Terjemahkan kalimat maupun paragraf panjang secara online dengan pengaturan nada (Natural, Formal, Akademik, Bisnis, Teknis), tingkat formalitas, profil gaya khusus, serta perbandingan alternatif frasa.',
      ctaLabel: 'Gunakan Penerjemah Teks',
      icon: Languages,
      spanClass: 'md:col-span-2',
      action: onFocusTranslator,
    },
    {
      id: 'dokumen',
      title: 'Penerjemah Dokumen & PDF',
      subtitle: 'PDF · DOCX · PPTX · TXT · HTML (Maks. 15 MB)',
      description:
        'Unggah dan terjemahkan berkas PDF (termasuk dokumen hasil pindai melalui OCR AI), Microsoft Word (.docx), PowerPoint (.pptx), HTML, serta teks polos sambil menjaga struktur isi dokumen.',
      ctaLabel: 'Buka Penerjemah Dokumen',
      icon: FileText,
      spanClass: 'md:col-span-1',
      action: () => onNavigateView('documents'),
    },
    {
      id: 'gambar',
      title: 'Penerjemah Gambar & OCR',
      subtitle: 'Image Translator · PNG · JPG · WEBP',
      description:
        'Deteksi dan terjemahkan teks pada foto, tangkapan layar, rambu, atau dokumen cetak hingga 10 MB, lengkap dengan pratinjau kotak teks (bounding-box) yang terdeteksi.',
      ctaLabel: 'Buka Penerjemah Gambar',
      icon: ImageIcon,
      spanClass: 'md:col-span-1',
      action: () => onNavigateView('images'),
    },
    {
      id: 'suara',
      title: 'Penerjemah Suara & Percakapan',
      subtitle: 'Voice Translator · Audio · Text-to-Speech',
      description:
        'Rekam suara dari mikrofon atau unggah rekaman audio untuk transkripsi dan terjemahan cepat. Tersedia mode percakapan dua arah serta pemutaran suara Text-to-Speech (TTS).',
      ctaLabel: 'Buka Penerjemah Suara',
      icon: Mic,
      spanClass: 'md:col-span-2',
      action: () => onNavigateView('voice'),
    },
    {
      id: 'kamus',
      title: 'Kamus Online Kontekstual',
      subtitle: 'Definisi · Kelas Kata · Contoh Kalimat',
      description:
        'Klik kata apa saja pada panel terjemahan atau buka tab Dictionary untuk menelaah arti kata berdasarkan konteks kalimat aslinya beserta contoh penggunaan.',
      ctaLabel: 'Buka Kamus Online',
      icon: BookOpen,
      spanClass: 'md:col-span-1',
      action: () => onNavigateView('dictionary'),
    },
    {
      id: 'glossary',
      title: 'Glossary Istilah Khusus',
      subtitle: 'Konsistensi Terminologi · Impor & Ekspor CSV',
      description:
        'Simpan padanan istilah teknis, nama merek, atau kosakata bidang tertentu dalam glossary pribadi agar hasil terjemahan selalu konsisten di teks maupun dokumen.',
      ctaLabel: 'Kelola Glossary',
      icon: ListChecks,
      spanClass: 'md:col-span-1',
      action: () => onNavigateView('glossary'),
    },
    {
      id: 'riwayat',
      title: 'Riwayat & Sinkronisasi Cloud',
      subtitle: 'IndexedDB Lokal · Opsional Google Sign-In',
      description:
        'Simpan, cari, tandai favorit, dan buka kembali riwayat penerjemahan Anda secara lokal di browser atau sinkronkan antar perangkat dengan masuk menggunakan akun Google.',
      ctaLabel: 'Lihat Riwayat Terjemahan',
      icon: History,
      spanClass: 'md:col-span-1',
      action: () => onNavigateView('history'),
    },
  ];

  const steps = [
    {
      num: '01.',
      title: 'Pilih Bahasa & Gaya Terjemahan',
      detail:
        'Tentukan bahasa sumber (atau biarkan Auto Detect), pilih bahasa tujuan, lalu sesuaikan nada, tingkat formalitas, atau konteks kalimat bila diperlukan.',
    },
    {
      num: '02.',
      title: 'Masukkan Teks atau Unggah Media',
      detail:
        'Ketik atau tempel teks di kotak penerjemah, atau pilih menu Translate Documents, Translate Images, maupun Translate Voice sesuai jenis materi Anda.',
    },
    {
      num: '03.',
      title: 'Periksa Kamus, Nuansa & Glossary',
      detail:
        'Klik kata hasil terjemahan untuk melihat kamus kontekstual, muat alternatif frasa, atau aktifkan glossary khusus untuk terminologi yang konsisten.',
    },
    {
      num: '04.',
      title: 'Salin, Dengarkan, atau Simpan ke Riwayat',
      detail:
        'Salin teks hasil terjemahan, dengarkan pelafalannya lewat Text-to-Speech, unduh dokumen hasil terjemahan, atau simpan ke riwayat pribadi Anda.',
    },
  ];

  return (
    <div className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800 space-y-12">
      {/* Feature Overview Grid */}
      <section id="fitur" aria-labelledby="fitur-heading" className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="max-w-2xl space-y-1.5">
            <h2
              id="fitur-heading"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance"
            >
              Fitur Lengkap EduZone LinguaFlow
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Satu ruang kerja translate online dan AI translator untuk kebutuhan belajar, kerja profesional, dan komunikasi lintas bahasa.
            </p>
          </div>
          <button
            type="button"
            onClick={onFocusTranslator}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <span>Coba sekarang di panel atas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <article
                key={feat.id}
                className={`${feat.spanClass} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {feat.subtitle}
                    </p>
                    <Icon
                      className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {feat.title}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {feat.description}
                  </p>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={feat.action}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                  >
                    <span>{feat.ctaLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* How-To Guide */}
      <section
        id="cara-pakai"
        aria-labelledby="cara-pakai-heading"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="cara-pakai-heading"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance"
            >
              Cara Menggunakan EduZone LinguaFlow
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Empat langkah praktis untuk menerjemahkan teks, dokumen, gambar, atau suara secara langsung di browser.
            </p>
          </div>
          <button
            type="button"
            onClick={onFocusTranslator}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <span>Mulai Terjemahkan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step) => (
            <li
              key={step.num}
              className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5"
            >
              <div className="text-xs font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                {step.num}
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {step.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ Section matching Schema.org FAQPage */}
      <section id="faq" aria-labelledby="faq-heading" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="faq-heading"
            className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance"
          >
            Pertanyaan yang Sering Diajukan (FAQ)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Informasi ringkas seputar fitur penerjemah AI, format berkas yang didukung, dan privasi data di EduZone LinguaFlow.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openFaqIdx === idx;
            return (
              <div key={item.question}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${idx}`}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left text-sm sm:text-[15px] font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <span>{item.question}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                <div
                  id={`faq-panel-${idx}`}
                  hidden={!isOpen}
                  className="px-5 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quiet Semantic Footer */}
      <footer className="pt-6 pb-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="space-y-1">
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            EduZone LinguaFlow — Aplikasi Penerjemah AI Online
          </p>
          <p>
            Privasi terjaga: teks, dokumen, riwayat pribadi, dan glossary pengguna tidak diindeks oleh mesin pencari.
          </p>
        </div>

        <nav aria-label="Tautan fitur footer" className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onFocusTranslator}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Terjemah Teks
          </button>
          <button
            type="button"
            onClick={() => onNavigateView('documents')}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Dokumen PDF/DOCX
          </button>
          <button
            type="button"
            onClick={() => onNavigateView('images')}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Gambar OCR
          </button>
          <button
            type="button"
            onClick={() => onNavigateView('voice')}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Suara &amp; TTS
          </button>
          <button
            type="button"
            onClick={() => onNavigateView('dictionary')}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Kamus
          </button>
          <button
            type="button"
            onClick={() => onNavigateView('glossary')}
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline whitespace-nowrap"
          >
            Glossary
          </button>
        </nav>
      </footer>
    </div>
  );
}
