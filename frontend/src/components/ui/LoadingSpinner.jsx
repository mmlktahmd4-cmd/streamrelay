export default function LoadingSpinner({ size = 'md', className = '' }) {
  const sizes = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div className={`flex justify-center items-center ${className}`}>
      <div className={`${sizes[size]} border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin`} />
    </div>
  );
}
