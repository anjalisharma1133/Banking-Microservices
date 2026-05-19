package com.banking.account.controller;

import com.banking.account.entity.User;
import com.banking.account.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/accounts")
@ConditionalOnProperty(name = "spring.application.name", havingValue = "account-service")
public class AccountController {

    @Autowired
    private UserRepository userRepository;

    @GetMapping
    public java.util.List<User> getAccounts(@RequestHeader(value = "X-User-UID", required = false) String uid) {
        if (uid == null) return java.util.Collections.emptyList();
        return userRepository.findByOwnerUid(uid).stream()
                .filter(u -> !"closed".equalsIgnoreCase(u.getStatus()))
                .collect(java.util.stream.Collectors.toList());
    }

    @GetMapping("/all")
    public java.util.List<User> getAllAccounts() {
        return userRepository.findAll();
    }

    @PostMapping("/{accountNumber}/deduct")
    public void deductBalance(@PathVariable String accountNumber, @RequestParam Double amount) {
        User user = userRepository.findByAccountNumber(accountNumber)
                .orElseThrow(() -> new RuntimeException("Account not found"));
        
        if (!"active".equals(user.getStatus())) {
            throw new RuntimeException("Account is " + user.getStatus() + ". Operation denied.");
        }

        if (user.getBalance() < amount) {
            throw new RuntimeException("Insufficient balance");
        }
        
        user.setBalance(user.getBalance() - amount);
        userRepository.save(user);
    }

    @PostMapping("/{accountNumber}/credit")
    public void creditBalance(@PathVariable String accountNumber, @RequestParam Double amount) {
        User user = userRepository.findByAccountNumber(accountNumber)
                .orElseThrow(() -> new RuntimeException("Account not found"));
        
        if (!"active".equals(user.getStatus())) {
            throw new RuntimeException("Account is " + user.getStatus() + ". Operation denied.");
        }

        user.setBalance(user.getBalance() + amount);
        userRepository.save(user);
    }

    @PostMapping("/sync-user")
    @jakarta.transaction.Transactional
    public User syncUser(@RequestBody User user) {
        // UPSERT logic: check if user exists by ID
        return userRepository.findById(user.getId())
                .map(existing -> {
                    // Avoid overwriting existing balance during periodic syncs to maintain consistency
                    // existing.setBalance(user.getBalance()); 
                    existing.setAccountNumber(user.getAccountNumber());
                    existing.setStatus(user.getStatus());
                    existing.setName(user.getName());
                    existing.setEmail(user.getEmail());
                    existing.setIsPrimary(user.getIsPrimary());
                    existing.setOwnerUid(user.getOwnerUid());
                    existing.setCustomerNumber(user.getCustomerNumber());
                    existing.setPassword(user.getPassword());
                    existing.setRole(user.getRole());
                    existing.setCurrency(user.getCurrency());
                    return userRepository.save(existing);
                })
                .orElseGet(() -> userRepository.save(user));
    }

    @PostMapping("/transfer")
    @jakarta.transaction.Transactional
    public org.springframework.http.ResponseEntity<?> transfer(@RequestParam String from, @RequestParam String to, @RequestParam Double amount) {
        try {
            User sender = userRepository.findByAccountNumber(from)
                    .orElseThrow(() -> new RuntimeException("Sender account " + from + " not found"));
            User recipient = userRepository.findByAccountNumber(to)
                    .orElseThrow(() -> new RuntimeException("Recipient account " + to + " not found"));

            if (!"active".equals(sender.getStatus())) {
                return org.springframework.http.ResponseEntity.status(403).body("Source account is " + sender.getStatus() + ". Transfer denied.");
            }
            if (!"active".equals(recipient.getStatus())) {
                return org.springframework.http.ResponseEntity.status(403).body("Recipient account is " + recipient.getStatus() + ". Transfer denied.");
            }

            if (sender.getBalance() < amount) {
                return org.springframework.http.ResponseEntity.status(400).body("Insufficient balance in account " + from);
            }

            sender.setBalance(sender.getBalance() - amount);
            recipient.setBalance(recipient.getBalance() + amount);

            userRepository.save(sender);
            userRepository.save(recipient);
            
            return org.springframework.http.ResponseEntity.ok("Transfer successful");
        } catch (Exception e) {
            return org.springframework.http.ResponseEntity.status(500).body("Internal error: " + e.getMessage());
        }
    }

    @DeleteMapping("/owner/{ownerUid}")
    @jakarta.transaction.Transactional
    public void deleteByOwnerUid(@PathVariable String ownerUid) {
        userRepository.deleteByOwnerUid(ownerUid);
    }
}
