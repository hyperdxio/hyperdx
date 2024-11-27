import AuthPage from '@/AuthPage';

export { getServerSideProps } from '@/emptyGetServerSideProps';

export default function Login() {
  return (
    <div>
      <AuthPage action="login" />
    </div>
  );
}
