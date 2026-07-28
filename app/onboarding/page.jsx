import { Onboarding } from "@/components/views/onboarding";

export const metadata = { title: "Configura tu empresa" };

// El wizard arranca en blanco y solo escribe al confirmar el último paso, así que
// no necesita cargar nada del servidor.
export default function OnboardingPage() {
  return <Onboarding />;
}
