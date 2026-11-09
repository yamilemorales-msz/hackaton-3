import { MessagePage } from '../components/ui';

export default function NotFoundPage() {
  return (
    <MessagePage title="404 · Esta sala no existe">
      <p>La ruta que abriste no forma parte del piso.</p>
    </MessagePage>
  );
}
