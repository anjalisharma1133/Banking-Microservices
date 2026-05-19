package com.banking.transaction.controller;

import com.banking.transaction.client.AccountClient;
import com.banking.transaction.dto.TransferRequest;
import com.banking.transaction.entity.Transaction;
import com.banking.transaction.repository.TransactionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Collections;

@RestController
@RequestMapping("/api/transactions")
@ConditionalOnProperty(name = "spring.application.name", havingValue = "transaction-service")
public class TransactionController {

    @Autowired
    private AccountClient accountClient;

    @Autowired
    private KafkaTemplate<String, Object> kafkaTemplate;

    @Autowired
    private TransactionRepository transactionRepository;

    @GetMapping
    public List<Transaction> getTransactions(
            @RequestHeader(value = "X-User-UID", required = false) String uid,
            @RequestHeader(value = "X-User-Role", required = false) String role) {
        if (uid == null) return Collections.emptyList();
        if ("admin".equalsIgnoreCase(role)) {
            return transactionRepository.findAllByOrderByTimestampDesc();
        }
        
        // Fetch user's account numbers to include incoming transfers
        try {
            List<com.banking.transaction.dto.AccountResponseDTO> accounts = accountClient.getAccounts(uid);
            if (accounts != null && !accounts.isEmpty()) {
                java.util.Set<String> accountNums = accounts.stream()
                    .map(com.banking.transaction.dto.AccountResponseDTO::getAccountNumber)
                    .collect(java.util.stream.Collectors.toSet());
                
                // Fetch all and filter (or use an optimized query - for mock/sim we can fetch a decent batch)
                // Using findByInitiatorUid for now, but really we want a query that takes a list of account numbers
                // For simplicity in this microservice sim, we'll fetch transactions where the user is initiator
                // OR where one of their accounts is sender/recipient.
                
                List<Transaction> allTxs = transactionRepository.findAllByOrderByTimestampDesc();
                return allTxs.stream()
                    .filter(t -> t.getInitiatorUid().equals(uid) || 
                               accountNums.contains(t.getFrom()) || 
                               accountNums.contains(t.getTo()))
                    .collect(java.util.stream.Collectors.toList());
            }
        } catch (Exception e) {
            System.err.println("[TRANSACTION] Failed to fetch accounts for enrichment: " + e.getMessage());
        }

        return transactionRepository.findByInitiatorUidOrderByTimestampDesc(uid);
    }

    @GetMapping("/{accountNumber}")
    public List<Transaction> getAccountTransactions(@PathVariable String accountNumber) {
        return transactionRepository.findByFromOrToOrderByTimestampDesc(accountNumber, accountNumber);
    }

    @PostMapping("/sync")
    public void syncTransaction(@RequestBody Transaction transaction) {
        if (!transactionRepository.existsById(transaction.getId())) {
            transactionRepository.save(transaction);
        }
    }

    @PostMapping("/transfer")
    public org.springframework.http.ResponseEntity<String> transfer(@RequestBody TransferRequest request, @RequestHeader(value = "X-User-UID", required = false) String uid) {
        System.out.println("[TRANSACTION] Processing transfer: from=" + request.getFrom() + " to=" + request.getTo() + " amount=" + request.getAmount());
        
        try {
            // SYNC PATH: Call Account Service via Feign (Atomic Transfer)
            org.springframework.http.ResponseEntity<String> response = accountClient.transfer(request.getFrom(), request.getTo(), request.getAmount());
            System.out.println("[TRANSACTION] Account service call successful: " + response.getBody());
        } catch (feign.FeignException e) {
            String errorMsg = e.contentUTF8();
            System.err.println("[TRANSACTION] Transfer failed at account-service (Feign): " + errorMsg);
            return org.springframework.http.ResponseEntity.status(e.status()).body(errorMsg);
        } catch (Exception e) {
            System.err.println("[TRANSACTION] Transfer failed with unknown error: " + e.getMessage());
            return org.springframework.http.ResponseEntity.status(500).body("Transaction Service Error: " + e.getMessage());
        }

        // PERSIST: Save to Transaction Database
        Transaction tx = new Transaction();
        tx.setFrom(request.getFrom());
        tx.setTo(request.getTo());
        tx.setAmount(request.getAmount());
        tx.setInitiatorUid(uid != null ? uid : "system");
        transactionRepository.save(tx);

        // ASYNC PATH: Produce to Kafka
        request.setInitiatorUid(tx.getInitiatorUid());
        kafkaTemplate.send("transaction-events", request);

        return org.springframework.http.ResponseEntity.ok("Transaction Processed Successfully");
    }
}
