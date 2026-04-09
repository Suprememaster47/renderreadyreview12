document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.ud-contact-form');
  
  if (!form) return; // Safety check

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Updated selectors to be more flexible (works for both input and select)
    const formData = {
      fullName: form.querySelector('[name="fullName"]').value,
      email: form.querySelector('[name="email"]').value || null,
      phone: form.querySelector('[name="phone"]').value,
      // FIX: removed 'textarea' so it finds the new <select name="message">
      message: form.querySelector('[name="message"]').value 
    };

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const result = await response.json();
      
      if (response.ok) {
        alert('✅ Message sent successfully!');
        form.reset();
      } else {
        alert('❌ Error: ' + (result.message || result.error || 'Check console'));
      }
    } catch (error) {
      console.error('Submission failed:', error);
      alert('❌ Failed to connect to server.');
    }
  });
});