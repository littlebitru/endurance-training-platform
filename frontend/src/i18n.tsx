import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "ru";

const en = {
  language: "Language",
  storyEyebrow: "ENDURANCE / TRAINING",
  storyTitleStart: "Build consistency.",
  storyTitleAccent: "Measure progress.",
  storyDescription: "One calm workspace for coaches and endurance athletes.",
  plan: "Plan",
  execute: "Execute",
  adapt: "Adapt",
  welcomeBack: "Welcome back",
  createYourAccount: "Create your account",
  signInSubtitle: "Sign in to continue your training cycle.",
  registerSubtitle: "Start with the role that matches your work.",
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  username: "Username",
  password: "Password",
  role: "Role",
  athlete: "Athlete",
  coach: "Coach",
  signIn: "Sign in",
  signingIn: "Signing in...",
  createAccount: "Create account",
  creatingAccount: "Creating account...",
  accountCreated: "Account created. Open the verification email before signing in.",
  requestFailed: "The request could not be completed.",
  usernameTaken: "This username is already registered.",
  emailTaken: "This email is already registered.",
  verificationRequired: "Email verification is required.",
  verifyOrReset: "Verify email or reset password",
  newHere: "New here? Create an account",
  alreadyRegistered: "Already registered? Sign in",
  accountSecurity: "ACCOUNT SECURITY",
  secureAccess: "Secure access.",
  clearProgress: "Clear progress.",
  backToSignIn: "Back to sign in",
  verifyingEmail: "Verifying your email...",
  incompleteVerification: "The verification link is incomplete.",
  emailVerified: "Email verified. You can now sign in.",
  emailVerification: "Email verification",
  accountHelp: "Account help",
  accountHelpText: "Request a new verification email or reset your password.",
  action: "Action",
  verifyEmail: "Verify email",
  resetPassword: "Reset password",
  sendEmail: "Send email",
  emailSent: "If the account matches, an email has been sent.",
  choosePassword: "Choose a new password",
  strongPassword: "Use a strong, unique password.",
  newPassword: "New password",
  updatePassword: "Update password",
  passwordUpdated: "Password updated. You can now sign in.",
  acceptingInvitation: "Accepting invitation...",
  invitationSignIn: "Sign in as the invited athlete, then open this link again.",
  invitationAccepted: "Invitation accepted. Your coach is now connected.",
  coachInvitation: "Coach invitation",
  trainingPlatform: "Training platform",
  overview: "Overview",
  trainingPlans: "Training plans",
  athletes: "Athletes",
  signOut: "Sign out",
  workspace: "workspace",
  clarity: "Good training starts with clarity.",
  apiConnected: "API connected",
  loading: "Loading training data...",
  currentCycle: "CURRENT CYCLE",
  cycleReady: "Your training cycle is ready",
  cycleDescription: "Create a plan and turn long-term goals into consistent daily work.",
  percentComplete: "% complete",
  completed: "completed",
  activePlans: "Active plans",
  plannedSessions: "Planned sessions",
  distanceCompleted: "Distance completed",
  averageEffort: "Average effort",
  comingUp: "COMING UP",
  nextSessions: "Next sessions",
  viewAll: "View all →",
  noUpcoming: "No upcoming sessions yet.",
  openIntensity: "Open intensity",
  distanceOpen: "Distance open",
  minutes: "min",
  training: "TRAINING",
  plansAndSessions: "Plans and sessions",
  active: "active",
  archived: "archived",
  week: "Week {number}",
  noPlans: "No training plans available.",
  roster: "ROSTER",
  yourAthletes: "Your athletes",
  inviteAthlete: "Invite athlete",
  invitationSent: "Invitation sent.",
  sportMissing: "Sport not selected",
  activeCoaching: "Active coaching",
  inactive: "Inactive",
  noAthletes: "Invite your first athlete to begin planning.",
  sportRunning: "running",
  sportCycling: "cycling",
  sportSwimming: "swimming",
  sportTriathlon: "triathlon",
  statusPlanned: "planned",
  statusCompleted: "completed",
  statusSkipped: "skipped",
} as const;

type TranslationKey = keyof typeof en;
type Dictionary = Record<TranslationKey, string>;

const ru: Dictionary = {
  language: "Язык",
  storyEyebrow: "ВЫНОСЛИВОСТЬ / ТРЕНИРОВКИ",
  storyTitleStart: "Развивайте стабильность.",
  storyTitleAccent: "Измеряйте прогресс.",
  storyDescription: "Единое пространство для тренеров и спортсменов циклических видов спорта.",
  plan: "Планируйте",
  execute: "Выполняйте",
  adapt: "Адаптируйте",
  welcomeBack: "С возвращением",
  createYourAccount: "Создайте аккаунт",
  signInSubtitle: "Войдите, чтобы продолжить тренировочный цикл.",
  registerSubtitle: "Выберите роль, соответствующую вашей работе.",
  email: "Электронная почта",
  firstName: "Имя",
  lastName: "Фамилия",
  username: "Имя пользователя",
  password: "Пароль",
  role: "Роль",
  athlete: "Спортсмен",
  coach: "Тренер",
  signIn: "Войти",
  signingIn: "Выполняется вход...",
  createAccount: "Создать аккаунт",
  creatingAccount: "Создаём аккаунт...",
  accountCreated: "Аккаунт создан. Подтвердите электронную почту перед входом.",
  requestFailed: "Не удалось выполнить запрос.",
  usernameTaken: "Это имя пользователя уже зарегистрировано.",
  emailTaken: "Эта электронная почта уже зарегистрирована.",
  verificationRequired: "Необходимо подтвердить электронную почту.",
  verifyOrReset: "Подтвердить почту или сбросить пароль",
  newHere: "Впервые здесь? Создать аккаунт",
  alreadyRegistered: "Уже зарегистрированы? Войти",
  accountSecurity: "БЕЗОПАСНОСТЬ АККАУНТА",
  secureAccess: "Безопасный доступ.",
  clearProgress: "Понятный прогресс.",
  backToSignIn: "Вернуться ко входу",
  verifyingEmail: "Подтверждаем электронную почту...",
  incompleteVerification: "Ссылка подтверждения неполная.",
  emailVerified: "Почта подтверждена. Теперь можно войти.",
  emailVerification: "Подтверждение почты",
  accountHelp: "Помощь с аккаунтом",
  accountHelpText: "Запросите новое письмо подтверждения или сбросьте пароль.",
  action: "Действие",
  verifyEmail: "Подтвердить почту",
  resetPassword: "Сбросить пароль",
  sendEmail: "Отправить письмо",
  emailSent: "Если аккаунт найден, письмо отправлено.",
  choosePassword: "Выберите новый пароль",
  strongPassword: "Используйте надёжный уникальный пароль.",
  newPassword: "Новый пароль",
  updatePassword: "Обновить пароль",
  passwordUpdated: "Пароль обновлён. Теперь можно войти.",
  acceptingInvitation: "Принимаем приглашение...",
  invitationSignIn: "Войдите как приглашённый спортсмен и снова откройте эту ссылку.",
  invitationAccepted: "Приглашение принято. Тренер подключён к вашему аккаунту.",
  coachInvitation: "Приглашение тренера",
  trainingPlatform: "Тренировочная платформа",
  overview: "Обзор",
  trainingPlans: "Тренировочные планы",
  athletes: "Спортсмены",
  signOut: "Выйти",
  workspace: "рабочее пространство",
  clarity: "Хорошая тренировка начинается с ясного плана.",
  apiConnected: "API подключён",
  loading: "Загружаем тренировочные данные...",
  currentCycle: "ТЕКУЩИЙ ЦИКЛ",
  cycleReady: "Ваш тренировочный цикл готов",
  cycleDescription: "Создайте план и превратите долгосрочные цели в последовательную ежедневную работу.",
  percentComplete: "% выполнено",
  completed: "выполнено",
  activePlans: "Активные планы",
  plannedSessions: "Запланировано тренировок",
  distanceCompleted: "Пройденная дистанция",
  averageEffort: "Средняя нагрузка",
  comingUp: "ВПЕРЕДИ",
  nextSessions: "Ближайшие тренировки",
  viewAll: "Показать все →",
  noUpcoming: "Ближайших тренировок пока нет.",
  openIntensity: "Интенсивность не указана",
  distanceOpen: "Дистанция не указана",
  minutes: "мин",
  training: "ТРЕНИРОВКИ",
  plansAndSessions: "Планы и тренировки",
  active: "активен",
  archived: "в архиве",
  week: "Неделя {number}",
  noPlans: "Тренировочных планов пока нет.",
  roster: "КОМАНДА",
  yourAthletes: "Ваши спортсмены",
  inviteAthlete: "Пригласить спортсмена",
  invitationSent: "Приглашение отправлено.",
  sportMissing: "Вид спорта не выбран",
  activeCoaching: "Активное сопровождение",
  inactive: "Неактивно",
  noAthletes: "Пригласите первого спортсмена, чтобы начать планирование.",
  sportRunning: "бег",
  sportCycling: "велоспорт",
  sportSwimming: "плавание",
  sportTriathlon: "триатлон",
  statusPlanned: "запланировано",
  statusCompleted: "выполнено",
  statusSkipped: "пропущено",
};

const dictionaries: Record<Locale, Dictionary> = { en, ru };

type LanguageValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageValue | null>(null);

function initialLocale(): Locale {
  const saved = localStorage.getItem("endurance_locale");
  if (saved === "en" || saved === "ru") return saved;
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem("endurance_locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LanguageValue>(() => ({
    locale,
    setLocale,
    t: (key, values = {}) => Object.entries(values).reduce(
      (message, [name, replacement]) => message.replace(`{${name}}`, String(replacement)),
      dictionaries[locale][key],
    ),
  }), [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}

export function localizeApiError(message: string, t: LanguageValue["t"]): string {
  const replacements: Array<[string, TranslationKey]> = [
    ["This username is already registered.", "usernameTaken"],
    ["This email is already registered.", "emailTaken"],
    ["Email verification is required.", "verificationRequired"],
  ];
  return replacements.reduce((localized, [source, key]) => localized.replace(source, t(key)), message);
}
